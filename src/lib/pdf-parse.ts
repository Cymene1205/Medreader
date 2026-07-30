/**
 * PDF Parsing Module
 *
 * Priority 1 — MinerU cloud service (highest quality, returns structured
 *              markdown + block JSON with page_idx/bbox/text_level).
 *              Enabled by MINERU_API_TOKEN env var. Falls through on
 *              any failure.
 *
 * Priority 2 — pdfjs-dist Node fallback (always available, MUST WORK).
 *              Uses the legacy build with an explicitly imported worker
 *              entry so GlobalWorkerOptions.workerSrc is set correctly.
 *
 * The MinerU result is rich (markdown + blocks + images); callers should
 * prefer parseWithMinerU() directly when they need the structured data.
 * This module's parsePdf() returns a plain-text string for compatibility.
 */

import { readFile, mkdtemp, rm } from "fs/promises";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join, basename } from "path";
import { parseWithMinerU, markdownToPlainText } from "./mineru";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse a PDF into PLAIN TEXT.
 * Tries MinerU first (best), then pdfjs-dist.
 * For structured markdown + blocks, call parseWithMinerU() directly.
 */
export async function parsePdf(filePath: string): Promise<string> {
  // Priority 1 — MinerU
  try {
    const result = await parseWithMinerU(filePath);
    if (result.markdown && result.markdown.trim().length > 0) {
      return markdownToPlainText(result.markdown);
    }
  } catch (e) {
    console.warn("[pdf-parse] MinerU failed, falling through to pdfjs:", e instanceof Error ? e.message : e);
  }

  // Priority 2 — pdfjs-dist Node fallback
  return parseWithPdfjs(filePath);
}

// ---------------------------------------------------------------------------
// Priority 2: pdfjs-dist Node fallback (FIXED worker setup)
// ---------------------------------------------------------------------------

async function parseWithPdfjs(filePath: string): Promise<string> {
  // Use the legacy build (designed for non-DOM environments).
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // ── FIX: explicitly set workerSrc to the legacy worker entry. ──
  // The previous version left workerSrc="" which made pdfjs try to
  // spawn a "fake worker" by dynamically importing its worker source
  // file, but it couldn't locate it on disk. We use the .mjs path
  // that ships with pdfjs-dist; Node can resolve it directly.
  try {
    // Resolve via Node module resolution
    const workerUrl = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      // `import.meta.url` works in ESM mode (Next.js compiles .ts to ESM)
      import.meta.url
    );
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;
  } catch {
    // Fallback: tell pdfjs to run worker on main thread (no worker).
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = "";
      // pdfjs-dist also exposes a "fake worker" path; setting
      // disableWorker=true on the loadingTask below ensures it.
    } catch {
      // ignore
    }
  }

  const fileBuffer = await readFile(filePath);
  const data = new Uint8Array(fileBuffer);

  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    // Run worker code on the main thread to avoid worker bootstrap issues.
    disableWorker: true,
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

    lines.sort((a, b) => b.y - a.y);

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

    const heights = items
      .map((it) => it.height)
      .filter((h) => h > 0)
      .sort((a, b) => a - b);
    const medianHeight =
      heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 10;

    if (isTwoColumn) {
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
    line.items.sort((a, b) => a.x - b.x);
    const parts: string[] = [];
    for (let j = 0; j < line.items.length; j++) {
      const it = line.items[j];
      if (j > 0) {
        const prev = line.items[j - 1];
        const prevEnd = prev.x + prev.width;
        const gap = it.x - prevEnd;
        const needsSpace = gap > medianHeight * 0.25 || prev.hasEOL;
        if (needsSpace && !it.str.startsWith(" ") && !parts[parts.length - 1]?.endsWith(" ")) {
          parts.push(" ");
        }
      }
      parts.push(it.str);
    }
    const text = parts.join("").trimEnd();
    if (text) out.push(text);
    if (i < lines.length - 1) {
      const gap = lines[i].y - lines[i + 1].y;
      if (gap > medianHeight * 1.5) {
        out.push("");
      }
    }
  }
  return out.join("\n");
}
