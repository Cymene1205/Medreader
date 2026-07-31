/**
 * Figure extraction — runs once after MinerU parse completes.
 *
 * Walks the MinerU content_list.json (blocks) and pulls out every "main"
 * figure caption, then pairs each caption with the nearest image/chart
 * block so we can show the actual image.
 *
 * ⚠️ Caption-anchored strategy (the OLD image-block-anchored strategy failed
 *    because MinerU vlm mode does NOT populate chart_caption on image blocks
 *    — captions are emitted as SEPARATE text blocks immediately after the
 *    image/chart blocks they describe).
 *
 * Algorithm:
 *   1. Walk all blocks looking for text blocks whose content starts with
 *      "Figure N" / "Fig. N" (excluding supplementary / Extended Data).
 *   2. Skip TOC-like entries (caption shorter than 30 chars, or containing
 *      URLs — these are paper-front-matter "Figure 1: Neutrophils alone:
 *      https://infection-atlas.org/..." index entries, not real captions).
 *   3. For each surviving caption, look BACKWARDS up to 5 blocks for the
 *      nearest image/chart block. If found, pair them. If a backward walk
 *      hits another caption or an H1 heading, stop (the caption likely has
 *      no associated image — keep the caption-only record).
 *   4. If no image found backward, look FORWARD up to 2 blocks as a
 *      fallback (some papers put caption above the figure).
 *   5. Even if no image block is found, the caption-only record is kept —
 *      Call A can still analyse the figure from caption + citing sentences.
 *
 * For each main figure, writes one row to the Figure table:
 *   { label, caption, imagePath, pageIndex, order, panelCount }
 *
 * label is normalised to "Figure N" form (e.g. "Fig. 3" → "Figure 3").
 *
 * This is a pure-code step — no LLM calls. The LLM enrichment happens later
 * in /api/figures (Call A: question / method / role / isLinchpin / chainIndex).
 *
 * Public entry point: extractAndStoreFigures(paperId)
 *   - Reads Paper.blocksJson from DB
 *   - Filters main-figure blocks
 *   - Deletes any existing Figure rows for this paper (idempotent re-runs)
 *   - Inserts one Figure row per main figure
 */

import { db } from "@/lib/db";
import type { MinerUBlock } from "@/lib/mineru";

export type ExtractedFigure = {
  label: string; // "Figure 3"
  caption: string;
  imagePath: string | null;
  pageIndex: number;
  order: number;
  panelCount: number;
};

/**
 * Regex to identify a main-figure caption at the START of a text block.
 * Matches "Figure 1", "Fig. 2", "Fig 3", "Figure 1A", "Figure 1:" — but NOT
 * "Fig. S1", "Figure S1", "Extended Data Figure 1", "Supplementary Figure 1".
 *
 * Captures the number so we can normalise the label.
 *
 * Note: this is anchored to the start (^\s*) — we don't want to pick up
 * in-text references like "...as shown in Figure 3, the cells...".
 */
const MAIN_FIGURE_RE = /^\s*(?!.*(?:Supplementary|Extended\s+Data|\bS\d))(?:Fig(?:ure|\.)?)\s*(\d+)/i;

/**
 * Normalise a label like "Fig. 3" / "Figure 3A" / "Fig 3" → "Figure 3".
 * Returns null if the input doesn't look like a main figure.
 */
export function normaliseFigureLabel(rawCaption: string): string | null {
  if (!rawCaption) return null;
  const m = rawCaption.match(MAIN_FIGURE_RE);
  if (!m) return null;
  const num = m[1];
  if (!num) return null;
  return `Figure ${num}`;
}

/**
 * Count sub-panels by scanning the caption for (a) (b) (c) patterns.
 * Looks for both parenthesised "(a)" and bare "a," "a." patterns at
 * panel-list positions. Returns 0 if can't infer (rare — most multi-panel
 * figures have a panel enumeration in the caption).
 */
export function countPanels(caption: string): number {
  if (!caption) return 0;
  // Strategy 1: explicit "(a) ... (b) ... (c)" enumeration
  const paren = caption.match(/\(\s*([a-z])\s*\)/gi);
  if (paren && paren.length >= 2) {
    // Take the highest letter mentioned
    const letters = paren
      .map((p) => p.replace(/[()]/g, "").trim().toLowerCase())
      .filter((c) => /^[a-z]$/.test(c));
    if (letters.length > 0) {
      const max = letters.reduce((m, c) => Math.max(m, c.charCodeAt(0) - 96), 0);
      return max;
    }
  }
  // Strategy 2: "(A–D)" / "(A-D)" range
  const range = caption.match(/\(\s*([A-Z])\s*[–\-—]\s*([A-Z])\s*\)/);
  if (range) {
    const start = range[1].charCodeAt(0) - 64;
    const end = range[2].charCodeAt(0) - 64;
    if (start > 0 && end >= start) return end;
  }
  // Strategy 3: "(a,b)" or "(a, b, c)" comma list
  const comma = caption.match(/\(\s*([a-z](?:\s*,\s*[a-z])*)\s*\)/i);
  if (comma) {
    const letters = comma[1].split(",").map((s) => s.trim().toLowerCase());
    if (letters.length >= 2 && letters.every((c) => /^[a-z]$/.test(c))) {
      return letters.reduce((m, c) => Math.max(m, c.charCodeAt(0) - 96), 0);
    }
  }
  return 0;
}

/**
 * Pull all main-figure captions out of the MinerU blocks array and pair each
 * one with the nearest image/chart block.
 *
 * Pure function — no DB. Returns the figures in document order.
 *
 * Strategy: caption-anchored (see file header for rationale).
 */
export function extractFiguresFromBlocks(
  blocks: MinerUBlock[],
  imagesDir: string | null
): ExtractedFigure[] {
  const out: ExtractedFigure[] = [];
  let order = 0;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "text") continue;
    const rawCap = (typeof b.text === "string" ? b.text : "").trim();
    if (!rawCap) continue;

    // Must start with "Figure N" / "Fig. N" / etc.
    const m = rawCap.match(MAIN_FIGURE_RE);
    if (!m) continue;
    const num = m[1];
    if (!num) continue;
    const label = `Figure ${num}`;

    // Filter out TOC / front-matter pseudo-captions:
    //   - Too short (real captions are usually 60+ chars)
    //   - Contains URL (TOC entries like "Figure 1: Neutrophils alone: https://...")
    if (rawCap.length < 30) continue;
    if (/https?:\/\//i.test(rawCap)) continue;

    // Dedup: if we already have this label, prefer the longer caption
    const existing = out.find((f) => f.label === label);
    if (existing) {
      if (rawCap.length > existing.caption.length) {
        existing.caption = rawCap;
      }
      continue;
    }

    // ── Look BACKWARD (up to 5 blocks) for the nearest image/chart block ──
    // MinerU usually emits: [image, image, image, ..., text="Figure N. ..."]
    // so the caption comes AFTER the last panel of the figure.
    let imgBlock: MinerUBlock | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const nb = blocks[j];
      if (nb.type === "image" || nb.type === "chart") {
        imgBlock = nb;
        break;
      }
      // Stop the backward walk if we hit another caption or an H1 heading —
      // it means our caption has no associated image block, which is fine
      // (we'll keep the caption-only record below).
      if (nb.type === "text") {
        const prevText = (nb.text || "").trim();
        if (/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(prevText)) break;
        if (typeof nb.text_level === "number" && nb.text_level === 1) break;
      }
    }

    // ── Fallback: look FORWARD (up to 2 blocks) ──
    // Some papers put caption above the figure. Rare but worth handling.
    if (!imgBlock) {
      for (let j = i + 1; j <= Math.min(blocks.length - 1, i + 2); j++) {
        const nb = blocks[j];
        if (nb.type === "image" || nb.type === "chart") {
          imgBlock = nb;
          break;
        }
      }
    }

    // Resolve image path. MinerU gives us "images/xxxxx.jpg" relative to
    // the extracted imagesDir.
    let imagePath: string | null = null;
    if (imgBlock?.img_path && imagesDir) {
      const cleanName = imgBlock.img_path
        .replace(/^images\//, "")
        .replace(/^\//, "");
      const basename = cleanName.split("/").pop();
      if (basename) {
        imagePath = `${imagesDir.replace(/\/$/, "")}/${basename}`;
      }
    }

    out.push({
      label,
      caption: rawCap,
      imagePath,
      pageIndex: (b.page_idx ?? 0) + 1, // 1-indexed
      order: order++,
      panelCount: countPanels(rawCap),
    });
  }

  return out;
}

/**
 * Public: extract figures from a paper's stored blocksJson and persist
 * to the Figure table. Idempotent — deletes existing rows first.
 *
 * Returns the count of figures written. Returns 0 if blocksJson is missing
 * or no figures were found (e.g. pdfjs fallback mode, or a review paper
 * with no figures).
 */
export async function extractAndStoreFigures(paperId: string): Promise<number> {
  const paper = await db.paper.findUnique({
    where: { id: paperId },
    select: { blocksJson: true, imagesDir: true },
  });
  if (!paper || !paper.blocksJson) return 0;

  let blocks: MinerUBlock[] = [];
  try {
    const parsed = JSON.parse(paper.blocksJson);
    if (Array.isArray(parsed)) blocks = parsed as MinerUBlock[];
  } catch {
    return 0;
  }
  if (blocks.length === 0) return 0;

  const figures = extractFiguresFromBlocks(blocks, paper.imagesDir);
  if (figures.length === 0) return 0;

  // Idempotent: clear any prior rows (e.g. from a previous attempt), then insert.
  await db.figure.deleteMany({ where: { paperId } });
  await db.figure.createMany({
    data: figures.map((f) => ({
      paperId,
      label: f.label,
      caption: f.caption,
      imagePath: f.imagePath,
      pageIndex: f.pageIndex,
      order: f.order,
      panelCount: f.panelCount,
    })),
  });

  return figures.length;
}
