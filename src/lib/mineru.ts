/**
 * MinerU Cloud API client.
 *
 * Reference: https://mineru.net/apiManage/docs
 *
 * Flow (精准解析 / batch upload mode):
 *   1. POST /api/v4/file-urls/batch  → get presigned OSS URLs + batch_id
 *   2. PUT each file to its presigned URL (no Content-Type header)
 *   3. GET  /api/v4/extract-results/batch/{batch_id}  → poll state
 *   4. When state === "done", download full_zip_url, unzip, read full.md
 *      + content_list.json (block-level structure with page_idx/bbox)
 */

import JSZip from "jszip";
import { readFile, mkdir, writeFile, rm, readdir } from "fs/promises";
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

// We deliberately do NOT import undici as an explicit dependency.
// Node 20+ ships with undici built-in, and the global `fetch` uses it.
// Importing `undici` as a top-level dep + adding it to
// `serverExternalPackages` breaks Next.js 16 Turbopack at page-data
// collection time with:
//   "Failed to load external module undici-XXX:
//    TypeError: webidl.util.markAsUncloneable is not a function"
// (undici 8.x's internal webidl lib is incompatible with Turbopack's
// module-cloning runtime on node:20-alpine).
//
// Instead, we rely on:
//   - Native `fetch` (uses built-in undici, headersTimeout=5min)
//   - Per-call `AbortController` for shorter, hard wall-clock timeouts
//   - `fetchWithRetry` for transient-error retry with backoff
//   - Per-call timing logs so we can see exactly which endpoint hangs
//
// The earlier `UND_ERR_HEADERS_TIMEOUT` was likely a downstream symptom
// of Docker marking the container unhealthy (IPv6 localhost issue in
// the healthcheck) and killing in-flight requests mid-flight — that's
// now fixed at the healthcheck level (see docker-compose.yml).

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
 *
 * Sample log lines (success / failure):
 *   [mineru] POST mineru.net → 200 in 412ms
 *   [mineru] PUT  xxx.oss-cn-xxx.aliyuncs.com → FAIL (ABORT_TIMEOUT) after 30012ms
 *
 * The host is logged instead of the full URL so presigned OSS URLs
 * (which contain signed query strings) don't leak into logs.
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
      `ineru] ${method} ${host} → FAIL (${code}) after ${ms}ms: ` +
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
 * - Network-level errors (timeouts, RST, DNS) → retry if code is in
 *   TRANSIENT_ERR_CODES.
 * - HTTP 5xx responses → retry (server may be overloaded).
 * - HTTP 4xx → never retry (client error, won't fix itself).
 * - HTTP 2xx → return immediately.
 *
 * Uses linear backoff: 1s, 2s, 3s for 3 attempts. Total worst-case
 * delay before giving up on a single call is ~6s plus the final
 * (failed) request's own timeout.
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
  // of strings — NOT flat strings. Typical content:
  //   chart_caption: ["Figure 2. SiglecF^hi neutrophils populate..."]
  //   image_caption: ["G", "Single-cell regulatory network inference (SCENIC)",
  //                   "Figure 1. Single-cell RNA (scRNA)-seq reveals..."]
  // The last item that starts with "Figure N" is the real caption; earlier
  // items are panel labels (A, B, C, G, ...). The Figure-extraction code in
  // src/lib/extract-figures.ts iterates the array and picks the "Figure N" item.
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
 * Upload a local PDF file to MinerU, poll for completion, then download
 * and unzip the result. Returns the markdown + blocks.
 */
export async function parseWithMinerU(filePath: string): Promise<MinerUResult> {
  // Step 1: request presigned upload URLs.
  // Retry on transient errors (MinerU API can be overloaded).
  // POST submit is a tiny JSON request to a fast endpoint — normally
  // returns in <1s. 30s timeout is generous; if it takes longer,
  // something is wrong and we should retry rather than hang.
  const fileName = basename(filePath);
  const submitRes = await fetchWithRetry(`${MINERU_BASE}/api/v4/file-urls/batch`, {
    method: "POST",
    timeoutMs: 30_000,
    headers: {
      Authorization: `Bearer ${MINERU_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "*/*",
    },
    body: JSON.stringify({
      files: [{ name: fileName, is_ocr: false, data_id: fileName }],
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
  const fileUrls: string[] = submitJson.data.file_urls;
  if (!batchId || !fileUrls || fileUrls.length === 0) {
    throw new Error(`MinerU submit missing batch_id / file_urls: ${JSON.stringify(submitJson)}`);
  }

  // Step 2: PUT the file to the presigned URL. Note: do NOT send
  // Content-Type header — OSS will reject it.
  // Retry on transient errors (network blips during large upload).
  // Timeout scales with file size: 30s per MB, capped at 5 min.
  // A 5MB PDF gets 150s; a 30MB PDF gets 300s (5 min cap).
  const fileBuffer = await readFile(filePath);
  const putTimeoutMs = Math.min(5 * 60 * 1000, 30_000 * Math.max(1, Math.ceil(fileBuffer.length / (1024 * 1024))));
  const putRes = await fetchWithRetry(fileUrls[0], {
    method: "PUT",
    timeoutMs: putTimeoutMs,
    body: fileBuffer,
    headers: {
      // OSS requires the body to be sent as raw bytes; specifying
      // Content-Type breaks the signature.
    },
  });
  if (!putRes.ok) {
    const txt = await putRes.text();
    throw new Error(`MinerU PUT upload failed ${putRes.status}: ${txt.slice(0, 300)}`);
  }

  // Step 3: poll batch status.
  const status = await pollBatchStatus(batchId);

  // Step 4: download and unzip.
  return await downloadAndExtract(status.full_zip_url!, filePath);
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
  // Use the custom Agent (longer timeouts) and retry on transient errors.
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

  // Rewrite image paths in markdown from images/xxx.jpg → absolute /api/paper-images/... later
  // (BlockReader will handle relative → served-URL mapping)
  // For now keep the original markdown; BlockReader uses blocks JSON which has img_path.

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
 *
 * MinerU usually emits the article title as one of the first few text blocks
 * on page 0, often (but not always) with text_level === 1. This function
 * scans the first ~15 blocks of page 0 and picks the most title-like text.
 *
 * Heuristics (in priority order):
 *   1. First text_level === 1 block that's > 15 chars and doesn't look like
 *      a section name (Abstract, Introduction, Methods, Results, etc.)
 *   2. First text block that:
 *        - is on page_idx 0
 *        - is not a page_number / header / footer
 *        - is between 20 and 280 chars
 *        - doesn't start with a section keyword
 *        - doesn't look like a date / DOI / email / author affiliation
 *   3. Fallback: return null (caller keeps the filename)
 *
 * The goal is "usually right" — when uncertain, we return null and let the
 * caller keep the original filename rather than guess wrong.
 */
export function extractPaperTitle(blocks: MinerUBlock[]): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  // Section keywords that should NOT be treated as titles
  const sectionKeywords = [
    "abstract", "introduction", "methods", "materials",
    "results", "discussion", "conclusion", "references",
    "background", "study design", "experimental",
    "摘要", "引言", "方法", "结果", "讨论", "结论", "参考文献",
  ];

  // Patterns that indicate "not a title"
  const notTitlePatterns = [
    /^https?:\/\//i,         // URLs
    /^doi:\s*/i,             // DOIs
    /^\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4}/,  // Dates
    /^\w+\s+\d{1,2},?\s*\d{4}$/,                    // "January 15, 2020"
    /^[\w.+-]+@[\w.-]+\.\w+$/,                      // Email
    /^vol\.?\s*\d+/i,        // Volume markers
    /^issue\s*\d+/i,         // Issue markers
    /^page\s*\d+/i,          // Page markers
    /^manuscript\s/i,
    /^article\s/i,
    /^research\s+article\s*$/i,
    /^received\s*:/i,
    /^accepted\s*:/i,
    /^published\s*:/i,
    /^©\s*\d{4}/i,           // Copyright
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
    // Section keyword (exact match or "starts with keyword + colon/space")
    for (const kw of sectionKeywords) {
      if (lower === kw) return true;
      if (lower.startsWith(kw + ":") || lower.startsWith(kw + " —") || lower.startsWith(kw + " -")) {
        return true;
      }
    }
    for (const pat of notTitlePatterns) {
      if (pat.test(text.trim())) return true;
    }
    // Pure author list: "Smith J, Brown K, Lee A et al." — usually short
    // and full of commas. Skip if it has > 3 commas and < 100 chars.
    const commaCount = (text.match(/,/g) || []).length;
    if (commaCount >= 3 && text.length < 100) return true;
    // Just numbers
    if (/^\d+$/.test(text.trim())) return true;
    // Affiliation marker (starts with digit+superscript marker or "*")
    if (/^\d+\s/.test(text.trim()) && text.length < 80) return true;
    if (/^\*\s/.test(text.trim())) return true;
    // All-caps short text (journal name like "NATURE", "CELL")
    if (text === text.toUpperCase() && text.length < 30 && /^[A-Z\s]+$/.test(text)) return true;
    return false;
  };

  // Step 1: prefer a text_level === 1 block on page_idx 0 in the first ~15 blocks
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

  // Step 2: scan first ~15 page-0 text blocks for the first title-like text
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

  // Step 3: fallback — return null (caller keeps filename)
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
  // Encode imagesDir as query param; the route reads file from disk.
  return `/api/paper-images?dir=${encodeURIComponent(imagesDir)}&name=${encodeURIComponent(name)}`;
}

/**
 * Extract a plain-text representation of the markdown by stripping
 * markdown syntax. Used as fallback context for chat when blocks are
 * not yet loaded on the client, and as the analyze prompt input.
 */
export function markdownToPlainText(md: string): string {
  return md
    // Remove image syntax
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片]")
    // Remove link syntax, keep text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // Remove heading markers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "[代码块]")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
