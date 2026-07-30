/**
 * PDF Parsing Module — Feature 3 (PDF Parsing Upgrade)
 *
 * `parsePdf(filePath)` returns a markdown-like plain text representation of
 * the supplied PDF by trying three parsing backends in order of preference:
 *
 * Priority 1 — MinerU remote service (highest quality, structured markdown).
 *   Enable by setting the environment variable:
 *     MINERU_API_URL=http://mineru.local:8000/api/v1
 *   Contract assumed:
 *     POST  {MINERU_API_URL}/file   (multipart/form-data, field "file" = PDF)
 *       -> { task_id: string } | { markdown: string }
 *     GET   {MINERU_API_URL}/task/{task_id}
 *       -> { status: "pending" | "processing" | "done" | "error", markdown?: string }
 *   If the env var is unset, the host is unreachable, or any unexpected
 *   response/timeout occurs, parsing silently falls through to Priority 2.
 *
 * Priority 2 — `marker_single` CLI subprocess (datalab/marker, high quality).
 *   Install with:  pip install marker-pdf
 *   We spawn:      marker_single <pdf_path> --output_dir <tmp_dir>
 *   The CLI writes `{output_dir}/{basename}.md`. We read & return it.
 *   If the binary is not on PATH or the subprocess errors, falls through.
 *
 * Priority 3 — pdfjs-dist Node fallback (always available, MUST WORK).
 *   Uses pdfjs-dist's text extraction and reconstructs a readable layout
 *   by grouping text items into lines, detecting double-column pages,
 *   sorting reading order, and inserting paragraph breaks on large gaps.
 *   No external services required — only the `pdfjs-dist` npm package.
 *
 * To permanently switch to MinerU, set MINERU_API_URL and ensure the
 * service is reachable; the fallback layers will then never be exercised.
 */

import { readFile, mkdtemp, rm } from "fs/promises";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join, basename } from "path";

const MINERU_API_URL = process.env.MINERU_API_URL;
const MINERU_TIMEOUT_MS = 120_000; // 2 min polling budget
const MINERU_POLL_INTERVAL_MS = 1500;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse a PDF file at `filePath` into markdown-like text.
 * Tries MinerU -> marker_single -> pdfjs-dist, returning the first success.
 */
export async function parsePdf(filePath: string): Promise<string> {
  // Priority 1 — MinerU remote service
  const mineruResult = await tryMineru(filePath).catch(() => null);
  if (mineruResult && mineruResult.trim().length > 0) {
    return mineruResult;
  }

  // Priority 2 — marker_single CLI
  const markerResult = await tryMarker(filePath).catch(() => null);
  if (markerResult && markerResult.trim().length > 0) {
    return markerResult;
  }

  // Priority 3 — pdfjs-dist Node fallback (always available)
  return parseWithPdfjs(filePath);
}

// ---------------------------------------------------------------------------
// Priority 1: MinerU
// ---------------------------------------------------------------------------

async function tryMineru(filePath: string): Promise<string | null> {
  if (!MINERU_API_URL) return null;

  const base = MINERU_API_URL.replace(/\/+$/, "");
  const buffer = await readFile(filePath);

  // Build multipart/form-data manually (no extra deps).
  const boundary = "medreader-" + Math.random().toString(16).slice(2);
  const fileName = basename(filePath);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        `Content-Type: application/pdf\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  let resp: Response;
  try {
    resp = await fetch(`${base}/file`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });
  } catch (e) {
    console.warn("[pdf-parse] MinerU unreachable:", e);
    return null;
  }

  if (!resp.ok) {
    console.warn(`[pdf-parse] MinerU POST /file returned ${resp.status}`);
    return null;
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    console.warn("[pdf-parse] MinerU returned non-JSON");
    return null;
  }

  // Direct markdown response — done in one shot.
  if (typeof data.markdown === "string" && data.markdown.trim()) {
    return data.markdown;
  }

  // Otherwise, treat as async task and poll.
  const taskId: string | undefined = data.task_id || data.taskId || data.id;
  if (!taskId) {
    console.warn("[pdf-parse] MinerU response had no task_id:", data);
    return null;
  }

  const deadline = Date.now() + MINERU_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(MINERU_POLL_INTERVAL_MS);
    let sResp: Response;
    try {
      sResp = await fetch(`${base}/task/${taskId}`);
    } catch (e) {
      console.warn("[pdf-parse] MinerU poll failed:", e);
      return null;
    }
    if (!sResp.ok) {
      console.warn(`[pdf-parse] MinerU GET /task/${taskId} -> ${sResp.status}`);
      return null;
    }
    let sData: any;
    try {
      sData = await sResp.json();
    } catch {
      continue;
    }
    const status: string = (sData.status || "").toLowerCase();
    if (status === "done" || status === "completed" || status === "success") {
      if (typeof sData.markdown === "string") return sData.markdown;
      if (typeof sData.result === "string") return sData.result;
      return null;
    }
    if (status === "error" || status === "failed") {
      console.warn("[pdf-parse] MinerU task failed:", sData);
      return null;
    }
    // pending / processing -> keep polling
  }
  console.warn("[pdf-parse] MinerU polling timed out");
  return null;
}

// ---------------------------------------------------------------------------
// Priority 2: marker_single CLI
// ---------------------------------------------------------------------------

async function tryMarker(filePath: string): Promise<string | null> {
  // Create a unique tmp output dir.
  const outDir = await mkdtemp(join(tmpdir(), "marker-"));
  try {
    const code = await runSpawn("marker_single", [
      filePath,
      "--output_dir",
      outDir,
    ]);
    if (code !== 0) {
      console.warn(`[pdf-parse] marker_single exited with code ${code}`);
      return null;
    }
    // marker writes <outDir>/<basename_without_ext>.md
    const baseName = basename(filePath).replace(/\.pdf$/i, "");
    const mdPath = join(outDir, `${baseName}.md`);
    try {
      const md = await readFile(mdPath, "utf-8");
      return md;
    } catch {
      // Some marker versions nest output in a subfolder named after the file.
      try {
        const altMdPath = join(outDir, baseName, `${baseName}.md`);
        return await readFile(altMdPath, "utf-8");
      } catch {
        return null;
      }
    }
  } finally {
    // Best-effort cleanup; ignore errors.
    rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runSpawn(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: "ignore" });
    } catch {
      resolve(-1);
      return;
    }
    child.on("error", () => resolve(-1));
    child.on("exit", (code) => resolve(typeof code === "number" ? code : -1));
  });
}

// ---------------------------------------------------------------------------
// Priority 3: pdfjs-dist Node fallback
// ---------------------------------------------------------------------------

async function parseWithPdfjs(filePath: string): Promise<string> {
  // The legacy build is built to work without a DOM. Try it first; if the
  // path doesn't exist (different package layout), fall back to the main
  // entry — both expose getDocument / GlobalWorkerOptions.
  let pdfjs: any;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjs = await import("pdfjs-dist");
  }

  // Disable worker — pdfjs will use a fake worker running on the main thread.
  // workerSrc="" prevents any attempt to fetch an external worker script.
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = "";
  } catch {
    // Some builds expose workerSrc differently; ignore if not settable.
  }

  const fileBuffer = await readFile(filePath);
  const data = new Uint8Array(fileBuffer);

  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  });

  const doc = await loadingTask.promise;
  let output = "";

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      output += `\n[Page ${i}]\n`;
      output += await extractPageText(doc, i);
      output += "\n";
    }
  } finally {
    try {
      await doc.cleanup();
      await doc.destroy();
    } catch {
      // ignore
    }
  }

  return output.trim();
}

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

async function extractPageText(doc: any, pageNum: number): Promise<string> {
  const page = await doc.getPage(pageNum);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth: number = viewport?.width || 0;
    const tc = await page.getTextContent();

    const items: TextItem[] = (tc.items as any[])
      .filter((it: any) => typeof it.str === "string")
      .map((it: any) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        width: it.width || 0,
        height: it.height || 0,
        hasEOL: !!it.hasEOL,
      }));

    if (items.length === 0) return "";

    // Group items by Y coordinate within a tolerance into "lines".
    const yTolerance = 3;
    const lines: { y: number; items: TextItem[] }[] = [];
    for (const it of items) {
      const existing = lines.find((l) => Math.abs(l.y - it.y) <= yTolerance);
      if (existing) {
        existing.items.push(it);
      } else {
        lines.push({ y: it.y, items: [it] });
      }
    }

    // Sort lines by Y descending — PDF coordinate origin is bottom-left,
    // so higher Y values are visually at the top of the page.
    lines.sort((a, b) => b.y - a.y);

    // Detect double-column layout: cluster line start X positions; if a
    // large gap exists splitting lines into two distinct columns AND the
    // gap sits roughly in the middle of the page, mark as two-column.
    const lineStartXs = lines
      .map((l) => Math.min(...l.items.map((it) => it.x)))
      .sort((a, b) => a - b);

    let isTwoColumn = false;
    let splitX = 0;
    if (lineStartXs.length >= 6 && pageWidth > 0) {
      let maxGap = 0;
      let gapIdx = -1;
      for (let i = 1; i < lineStartXs.length; i++) {
        const gap = lineStartXs[i] - lineStartXs[i - 1];
        if (gap > maxGap) {
          maxGap = gap;
          gapIdx = i;
        }
      }
      // Heuristic: gap should be > 8% of page width and the split should
      // land in the middle 50% of the page (i.e. between 25% and 75%).
      const lowerBound = pageWidth * 0.25;
      const upperBound = pageWidth * 0.75;
      if (
        gapIdx > 0 &&
        maxGap > pageWidth * 0.08 &&
        lineStartXs[gapIdx - 1] < upperBound &&
        lineStartXs[gapIdx] > lowerBound
      ) {
        isTwoColumn = true;
        splitX = (lineStartXs[gapIdx - 1] + lineStartXs[gapIdx]) / 2;
      }
    }

    // Compute median line height for paragraph-break detection.
    const heights = items
      .map((it) => it.height)
      .filter((h) => h > 0)
      .sort((a, b) => a - b);
    const medianHeight =
      heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;

    if (isTwoColumn) {
      // Partition lines into left/right columns, then read each column
      // top-to-bottom (already sorted) — left column first, then right.
      const left = lines.filter((l) => Math.min(...l.items.map((i) => i.x)) < splitX);
      const right = lines.filter((l) => Math.min(...l.items.map((i) => i.x)) >= splitX);
      return renderLines(left, medianHeight) + "\n" + renderLines(right, medianHeight);
    }

    return renderLines(lines, medianHeight);
  } finally {
    try {
      page.cleanup();
    } catch {
      // ignore
    }
  }
}

function renderLines(lines: { y: number; items: TextItem[] }[], medianHeight: number): string {
  if (lines.length === 0) return "";

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Sort items in the line by X ascending (left -> right reading order).
    line.items.sort((a, b) => a.x - b.x);

    // Join items, inserting a space when there's a horizontal gap between
    // the end of one item and the start of the next.
    const parts: string[] = [];
    for (let j = 0; j < line.items.length; j++) {
      const it = line.items[j];
      if (j > 0) {
        const prev = line.items[j - 1];
        const prevEnd = prev.x + prev.width;
        const gap = it.x - prevEnd;
        // Insert a space if there's a meaningful gap (more than ~25% of
        // median char width, or item ended with EOL marker).
        const needsSpace = gap > medianHeight * 0.25 || prev.hasEOL;
        if (needsSpace && !it.str.startsWith(" ") && !parts[parts.length - 1]?.endsWith(" ")) {
          parts.push(" ");
        }
      }
      parts.push(it.str);
    }
    const text = parts.join("").trimEnd();
    if (text) out.push(text);

    // Detect paragraph break: gap to the next line is > 1.5x median height.
    if (i < lines.length - 1) {
      const gap = lines[i].y - lines[i + 1].y;
      if (gap > medianHeight * 1.5) {
        out.push(""); // blank line separator
      }
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
