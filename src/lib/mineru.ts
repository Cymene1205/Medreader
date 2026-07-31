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
const POLL_TIMEOUT_MS = 180_000; // 3 min cap

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
  const fileName = basename(filePath);
  const submitRes = await fetch(`${MINERU_BASE}/api/v4/file-urls/batch`, {
    method: "POST",
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
  const fileBuffer = await readFile(filePath);
  const putRes = await fetch(fileUrls[0], {
    method: "PUT",
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
      resp = await fetch(
        `${MINERU_BASE}/api/v4/extract-results/batch/${batchId}`,
        { headers: { Authorization: `Bearer ${MINERU_TOKEN}`, Accept: "*/*" } }
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
  const zipRes = await fetch(zipUrl);
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
