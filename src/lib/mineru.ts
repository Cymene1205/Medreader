/**
 * MinerU Cloud API client (URL-pull mode).
 *
 * IMPORTANT — 2026-08-01 switch:
 *   We previously used /api/v4/file-urls/batch, which returns OSS presigned
 *   PUT URLs and requires the client to upload the PDF to OSS. On Alibaba
 *   Cloud Lightweight Server (2 vCPU / 2 GiB / ~3 Mbps public uplink),
 *   PUT-ing a 5 MB medical PDF to oss-cn-shanghai kept timing out after
 *   5 minutes (ABORT_TIMEOUT, retried 3x, total 15 min) because the
 *   public uplink is too slow to push the file before OSS presigned URL
 *   signature expiry. The container was healthy, network to mineru.net
 *   was fine — only the upstream bandwidth to OSS was the bottleneck.
 *
 *   Switched to /api/v4/extract/task/batch (URL-pull mode): we POST a
 *   short JSON containing a public URL pointing back to OUR server, and
 *   MinerU's backend downloads the PDF itself. Our server's downstream
 *   bandwidth is 100 Mbps+, so MinerU can pull the file in milliseconds.
 *
 * Flow (URL-pull mode):
 *   1. POST /api/v4/extract/task/batch  with files[].url = our public PDF URL
 *      → returns batch_id
 *   2. GET  /api/v4/extract-results/batch/{batch_id}  → poll state
 *   3. When state === "done", download full_zip_url, unzip, read full.md
 *      + content_list.json (block-level structure with page_idx/bbox)
 *
 * Reference: https://mineru.net/apiManage/docs
 */

import JSZip from "jszip";
import { readFile, mkdir, writeFile, readdir } from "fs/promises";
import { join, basename, dirname } from "path";

const MINERU_BASE = "https://mineru.net";
// No hardcoded fallback — must be supplied via env var.
// On missing token, calls will fail fast with a clear auth error.
const MINERU_TOKEN = process.env.MINERU_API_TOKEN || "";
const POLL_INTERVAL_MS = 3500;
// vlm mode on large scientific PDFs (30+ pages, lots of figures/tables)
// can take 4-6 minutes. Give polling a 10-min ceiling before giving up
// and falling through to pdfjs-dist.
const POLL_TIMEOUT_MS = 600_000; // 10 min cap

// Per-call options. `timeoutMs` is enforced via AbortController —
// this works with native fetch, no undici import needed.
type MinerURequestInit = RequestInit & {
  /** Per-call wall-clock timeout in ms. Default: 30000 (30s). */
  timeoutMs?: number;
};

/**
 * Wrap fetch with: (a) per-call AbortController timeout, (b) per-call
 * timing log so we can see EXACTLY which MinerU endpoint hangs and how
 * long it takes.
 */
async function mineruFetch(url: string, init: MinerURequestInit = {}): Promise<Response> {
  const { timeoutMs, ...restInit } = init;
  const method = init.method || "GET";
  // Extract host for logging (strip query string, strip path)
  let host = "?";
  try {
    const u = new URL(url);
    host = u.host;
  } catch {}
  // Set up AbortController for hard wall-clock timeout.
  const timeout = timeoutMs ?? 30_000; // default 30s
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // If caller provided their own signal, propagate its abort to ours.
  if (restInit.signal) {
    const callerSignal = restInit.signal as AbortSignal;
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  restInit.signal = controller.signal;
  const t0 = Date.now();
  try {
    const res = await fetch(url, restInit);
    const ms = Date.now() - t0;
    console.log(`[mineru] ${method} ${host} → ${res.status} in ${ms}ms`);
    return res;
  } catch (e: any) {
    const ms = Date.now() - t0;
    // AbortController abort produces e.name === 'AbortError'. Native fetch
    // in Node 20+ wraps it as a TypeError with cause.code === 'UND_ERR_ABORTED'
    // in some cases. Normalize the code for the retry logic downstream.
    let code = e?.code || e?.cause?.code || "?";
    const isAbort = e?.name === "AbortError" || code === "UND_ERR_ABORTED";
    if (isAbort) {
      code = "ABORT_TIMEOUT";
    }
    // Do NOT mutate e.message directly. When `e` is a DOMException
    // (the type AbortController produces), `.message` is a getter-only
    // property on the prototype — direct assignment throws
    // "Cannot set property message of which has only a getter",
    // which masks the real error and bubbles up as a TypeError.
    const logMsg = isAbort
      ? `Request aborted after ${ms}ms (timeoutMs=${timeout})`
      : (e?.message || String(e));
    console.error(
      `[mineru] ${method} ${host} → FAIL (${code}) after ${ms}ms: ` +
      `${logMsg}. ` +
      `URL: ${url.slice(0, 120)}${url.length > 120 ? "..." : ""}`
    );
    // DOMException.code is a numeric getter (returns 0 for AbortError),
    // not the string "ABORT_TIMEOUT" we set above. fetchWithRetry reads
    // e.code to decide whether to retry — if the original error's code
    // doesn't match our normalized value, wrap it in a plain Error that
    // carries .code as a real own property.
    if (e?.code !== code) {
      const wrapped = new Error(`${code}: ${logMsg}`) as Error & {
        code?: string;
        cause?: unknown;
      };
      wrapped.code = code;
      wrapped.cause = e;
      throw wrapped;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Transient undici error codes that are worth retrying. Anything not in
// this set (e.g. EACCES, EPERM) is a permanent failure and should bubble.
const TRANSIENT_ERR_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT", // server took too long to send response headers
  "UND_ERR_BODY_TIMEOUT",    // server stopped sending body mid-stream
  "UND_ERR_CONNECT_TIMEOUT", // couldn't establish TCP connection in time
  "UND_ERR_SOCKET",          // socket closed unexpectedly
  "ABORT_TIMEOUT",           // our own AbortController fired (per-call timeout)
  "ECONNRESET",              // TCP RST from peer or load balancer
  "ECONNREFUSED",            // server not listening (might come back up)
  "ENOTFOUND",               // DNS lookup failed (might be transient)
  "EAI_AGAIN",               // DNS temporary failure
  "ETIMEDOUT",               // generic OS-level timeout
]);

/**
 * Fetch with retry on transient failures and 5xx server errors.
 */
async function fetchWithRetry(
  url: string,
  init: MinerURequestInit,
  maxAttempts = 3,
  backoffMs = 1000
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await mineruFetch(url, init);
      // Retry on 5xx if we have attempts left
      if (res.status >= 500 && attempt < maxAttempts) {
        // Drain body to free the socket for reuse
        try { await res.text(); } catch {}
        console.warn(
          `[mineru] ${init.method || "GET"} ${url} → ${res.status}, retrying ` +
          `(attempt ${attempt}/${maxAttempts}) in ${backoffMs * attempt}ms`
        );
        await sleep(backoffMs * attempt);
        continue;
      }
      return res;
    } catch (e: any) {
      lastErr = e;
      const code = e?.code || e?.cause?.code;
      const isTransient = TRANSIENT_ERR_CODES.has(code);
      if (attempt < maxAttempts && isTransient) {
        console.warn(
          `[mineru] ${init.method || "GET"} ${url} → ${code || e?.message}, ` +
          `retrying (attempt ${attempt}/${maxAttempts}) in ${backoffMs * attempt}ms`
        );
        await sleep(backoffMs * attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export type MinerUBlock = {
  type: string; // text | image | table | equation | chart | header | footer | page_number | page_footnote | ref_text
  text?: string;
  text_level?: number; // 1-6 for headings
  text_format?: any;
  content?: any;
  img_path?: string;
  bbox?: [number, number, number, number];
  page_idx?: number; // 0-indexed
  table_body?: string; // HTML
  table_caption?: string;
  table_footnote?: string;
  // ⚠️ MinerU vlm mode emits BOTH chart_caption AND image_caption as ARRAYS
  // of strings — NOT flat strings.
  chart_caption?: string[];
  chart_footnote?: string[];
  image_caption?: string[];
  image_footnote?: string[];
};

export type MinerUResult = {
  markdown: string;
  blocks: MinerUBlock[];
  imagesDir: string | null; // absolute path to extracted images dir
  pageCount: number;
};

type BatchStatus = {
  state: "waiting-file" | "pending" | "running" | "converting" | "done" | "failed";
  full_zip_url?: string;
  err_msg?: string;
  extract_progress?: { extracted_pages: number; total_pages: number; start_time: string };
};

/**
 * Submit a PDF (by public URL) to MinerU for extraction.
 *
 * Uses /api/v4/extract/task/batch (URL-pull mode) instead of the
 * legacy /api/v4/file-urls/batch (OSS PUT mode). See file header
 * comment for the rationale.
 *
 * @param pdfPublicUrl  Public URL MinerU's backend can fetch. Must be
 *                      reachable from the public internet (no login
 *                      required). The /api/paper/[id]/pdf route on our
 *                      own server serves this — see upload/route.ts.
 * @param fileName      Original filename, used as data_id for tracing.
 * @returns             batch_id to poll with pollBatchStatus().
 */
export async function submitToMinerU(
  pdfPublicUrl: string,
  fileName: string
): Promise<string> {
  const submitRes = await fetchWithRetry(`${MINERU_BASE}/api/v4/extract/task/batch`, {
    method: "POST",
    timeoutMs: 30_000,
    headers: {
      Authorization: `Bearer ${MINERU_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "*/*",
    },
    body: JSON.stringify({
      files: [{ url: pdfPublicUrl, is_ocr: false, data_id: fileName }],
      // vlm = best for scientific PDFs with tables/equations/figures
      model_version: "vlm",
      enable_formula: true,
      enable_table: true,
      language: "ch",
    }),
  });

  if (!submitRes.ok) {
    const txt = await submitRes.text();
    throw new Error(`MinerU submit failed ${submitRes.status}: ${txt}`);
  }
  const submitJson: any = await submitRes.json();
  if (submitJson.code !== 0 || !submitJson.data) {
    throw new Error(`MinerU submit error: ${JSON.stringify(submitJson)}`);
  }
  const batchId: string = submitJson.data.batch_id;
  if (!batchId) {
    throw new Error(`MinerU submit missing batch_id: ${JSON.stringify(submitJson)}`);
  }
  return batchId;
}

/**
 * Upload a local PDF file to MinerU, poll for completion, then download
 * and unzip the result.
 *
 * NOTE: In URL-pull mode, this function does NOT upload the PDF bytes
 * anywhere. It only tells MinerU "go fetch the PDF from this URL".
 * The caller is responsible for ensuring the PDF is publicly reachable
 * at `pdfPublicUrl` BEFORE calling this function.
 */
export async function parseWithMinerU(
  localFilePath: string,
  pdfPublicUrl: string
): Promise<MinerUResult> {
  const fileName = basename(localFilePath);

  // Step 1: submit URL to MinerU (no PUT step anymore).
  const batchId = await submitToMinerU(pdfPublicUrl, fileName);

  // Step 2: poll batch status.
  const status = await pollBatchStatus(batchId);

  // Step 3: download and unzip.
  return await downloadAndExtract(status.full_zip_url!, localFilePath);
}

async function pollBatchStatus(batchId: string): Promise<{ full_zip_url: string; pageCount: number }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus: BatchStatus | null = null;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let resp: Response;
    try {
      resp = await mineruFetch(
        `${MINERU_BASE}/api/v4/extract-results/batch/${batchId}`,
        { headers: { Authorization: `Bearer ${MINERU_TOKEN}`, Accept: "*/*" }, timeoutMs: 30_000 }
      );
    } catch (e) {
      console.warn("[mineru] poll fetch error:", e);
      continue;
    }
    if (!resp.ok) {
      console.warn(`[mineru] poll status ${resp.status}`);
      continue;
    }
    const j: any = await resp.json();
    if (j.code !== 0 || !j.data) {
      console.warn("[mineru] poll bad json:", j);
      continue;
    }
    // Batch result is an array of single-file results.
    const results: any[] = j.data.extract_result || j.data.results || [];
    if (results.length === 0) continue;
    const r0 = results[0] as BatchStatus;
    lastStatus = r0;
    const state = r0.state;
    console.log(`[mineru] state=${state} progress=${JSON.stringify(r0.extract_progress || {})}`);
    if (state === "done" && r0.full_zip_url) {
      const pageCount = r0.extract_progress?.total_pages || 0;
      return { full_zip_url: r0.full_zip_url, pageCount };
    }
    if (state === "failed") {
      throw new Error(`MinerU parse failed: ${r0.err_msg || "unknown error"}`);
    }
  }
  throw new Error(
    `MinerU polling timed out after ${POLL_TIMEOUT_MS / 1000}s. Last status: ${JSON.stringify(lastStatus)}`
  );
}

async function downloadAndExtract(zipUrl: string, originalPath: string): Promise<MinerUResult> {
  // MinerU's OSS-hosted zip can be slow to start streaming for large PDFs.
  // Zip is typically 1-30MB; 180s gives margin for slow connections.
  const zipRes = await fetchWithRetry(zipUrl, { method: "GET", timeoutMs: 180_000 });
  if (!zipRes.ok) {
    throw new Error(`MinerU zip download failed ${zipRes.status}`);
  }
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  const zip = await JSZip.loadAsync(zipBuf);

  // Locate full.md (top-level or in a subfolder)
  let markdown = "";
  const mdFile = Object.values(zip.files).find(
    (f) => !f.dir && f.name.endsWith("full.md")
  );
  if (mdFile) {
    markdown = await mdFile.async("string");
  }

  // Locate content_list.json (any file ending with _content_list.json or
  // named content_list.json — MinerU varies)
  let blocks: MinerUBlock[] = [];
  const clFile = Object.values(zip.files).find(
    (f) => !f.dir && /_?content_list\.json$/.test(f.name) && !f.name.includes("_v2")
  );
  if (clFile) {
    try {
      const txt = await clFile.async("string");
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) {
        blocks = parsed as MinerUBlock[];
      }
    } catch (e) {
      console.warn("[mineru] content_list.json parse error:", e);
    }
  }

  // Extract images to a sibling directory of the original PDF.
  // uploads/abc.pdf → uploads/abc_images/
  const baseNoExt = basename(originalPath).replace(/\.pdf$/i, "");
  const imagesDir = join(dirname(originalPath), `${baseNoExt}_images`);
  await mkdir(imagesDir, { recursive: true });
  const imageFiles = Object.values(zip.files).filter(
    (f) => !f.dir && /images\//.test(f.name)
  );
  for (const img of imageFiles) {
    const name = basename(img.name);
    if (!name) continue;
    const data = await img.async("nodebuffer");
    await writeFile(join(imagesDir, name), data);
  }

  // Page count: max page_idx + 1, fallback 0
  const pageCount =
    blocks.reduce((m, b) => Math.max(m, (b.page_idx ?? 0) + 1), 0) || 0;

  return { markdown, blocks, imagesDir, pageCount };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extract the paper title from MinerU blocks.
 */
export function extractPaperTitle(blocks: MinerUBlock[]): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  const sectionKeywords = [
    "abstract", "introduction", "methods", "materials",
    "results", "discussion", "conclusion", "references",
    "background", "study design", "experimental",
    "摘要", "引言", "方法", "结果", "讨论", "结论", "参考文献",
  ];

  const notTitlePatterns = [
    /^https?:\/\//i,
    /^doi:\s*/i,
    /^\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4}/,
    /^\w+\s+\d{1,2},?\s*\d{4}$/,
    /^[\w.+-]+@[\w.-]+\.\w+$/,
    /^vol\.?\s*\d+/i,
    /^issue\s*\d+/i,
    /^page\s*\d+/i,
    /^manuscript\s/i,
    /^article\s/i,
    /^research\s+article\s*$/i,
    /^received\s*:/i,
    /^accepted\s*:/i,
    /^published\s*:/i,
    /^©\s*\d{4}/i,
    /^corresponding author/i,
    /^author contributions/i,
    /^author contribution$/i,
    /^conflict of interest/i,
    /^acknowledgement/i,
    /^keywords?:/i,
    /^funding:/i,
    /^ethics/i,
  ];

  const isLikelyNotTitle = (text: string): boolean => {
    const lower = text.toLowerCase().trim();
    if (lower.length === 0) return true;
    for (const kw of sectionKeywords) {
      if (lower === kw) return true;
      if (lower.startsWith(kw + ":") || lower.startsWith(kw + " —") || lower.startsWith(kw + " -")) {
        return true;
      }
    }
    for (const pat of notTitlePatterns) {
      if (pat.test(text.trim())) return true;
    }
    const commaCount = (text.match(/,/g) || []).length;
    if (commaCount >= 3 && text.length < 100) return true;
    if (/^\d+$/.test(text.trim())) return true;
    if (/^\d+\s/.test(text.trim()) && text.length < 80) return true;
    if (/^\*\s/.test(text.trim())) return true;
    if (text === text.toUpperCase() && text.length < 30 && /^[A-Z\s]+$/.test(text)) return true;
    return false;
  };

  const head = blocks.slice(0, 20);
  const page0Headings = head.filter(
    (b) =>
      b.type === "text" &&
      b.text_level === 1 &&
      (b.page_idx ?? 0) === 0 &&
      b.text &&
      b.text.trim().length >= 15 &&
      b.text.trim().length <= 280 &&
      !isLikelyNotTitle(b.text)
  );
  if (page0Headings.length > 0) {
    return page0Headings[0].text!.trim().slice(0, 280);
  }

  const page0Texts = head.filter(
    (b) =>
      (b.type === "text" || b.type === "title") &&
      (b.page_idx ?? 0) === 0 &&
      b.text &&
      b.text.trim().length >= 20 &&
      b.text.trim().length <= 280
  );
  for (const b of page0Texts) {
    const t = b.text!.trim();
    if (!isLikelyNotTitle(t)) {
      return t.slice(0, 280);
    }
  }

  return null;
}

/**
 * Map MinerU block img_path ("images/xxx.jpg") to a served URL via
 * /api/paper-images?dir=<imagesDir>&name=<basename>.
 */
export function mapImagePath(imgPath: string | undefined, imagesDir: string | null): string | null {
  if (!imgPath) return null;
  const name = basename(imgPath);
  if (!imagesDir) return null;
  return `/api/paper-images?dir=${encodeURIComponent(imagesDir)}&name=${encodeURIComponent(name)}`;
}

/**
 * Extract a plain-text representation of the markdown by stripping
 * markdown syntax.
 */
export function markdownToPlainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, "[代码块]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
