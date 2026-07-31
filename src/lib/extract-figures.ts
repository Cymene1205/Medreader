/**
 * Figure extraction — runs once after MinerU parse completes.
 *
 * Walks the MinerU content_list.json (blocks) and pulls out every "main"
 * figure block:
 *   - Block type is "image" or "chart"
 *   - The caption (chart_caption) starts with "Figure N" / "Fig. N" (not "Fig. S",
 *     not "Extended Data", not "Supplementary")
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
 * Regex to identify a main-figure caption.
 * Matches "Figure 1", "Fig. 2", "Fig 3", "Figure 1A" — but NOT
 * "Fig. S1", "Figure S1", "Extended Data Figure 1", "Supplementary Figure 1".
 *
 * Captures the number so we can normalise the label.
 */
const MAIN_FIGURE_RE = /^(?!.*(?:Supplementary|Extended\s+Data|\bS\d))\s*(?:Fig(?:ure|\.)?)\s*(\d+)/i;

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
 * Pull all main-figure blocks out of the MinerU blocks array.
 * Pure function — no DB. Returns the figures in document order.
 */
export function extractFiguresFromBlocks(
  blocks: MinerUBlock[],
  imagesDir: string | null
): ExtractedFigure[] {
  const out: ExtractedFigure[] = [];
  let order = 0;
  for (const b of blocks) {
    if (b.type !== "image" && b.type !== "chart") continue;
    const rawCap =
      (typeof b.chart_caption === "string" && b.chart_caption) ||
      (typeof b.text === "string" && b.text) ||
      "";
    if (!rawCap) continue;
    const label = normaliseFigureLabel(rawCap);
    if (!label) continue;

    // De-duplicate: MinerU sometimes emits two adjacent blocks for the same
    // figure (one for the image, one for the caption). Skip if we already
    // have this label within the last 3 entries (close document position).
    if (out.length > 0 && out[out.length - 1].label === label) {
      // Merge caption text if the duplicate has a longer caption
      if (rawCap.length > out[out.length - 1].caption.length) {
        out[out.length - 1].caption = rawCap;
      }
      continue;
    }

    // Resolve image path. MinerU gives us "images/xxxxx.jpg" relative to
    // the extracted imagesDir. We store the absolute path on the row so
    // /api/figure-image/[figureId] can stream it without recomputing.
    let imagePath: string | null = null;
    if (b.img_path && imagesDir) {
      // Strip "images/" prefix if present, then join with imagesDir
      const cleanName = b.img_path.replace(/^images\//, "").replace(/^\//, "");
      const basename = cleanName.split("/").pop();
      if (basename) {
        // We can't import "path" here cleanly in browser-built code paths,
        // but this lib is server-only (only called from upload route which
        // runs in nodejs runtime). Use a simple string concat.
        imagePath = `${imagesDir.replace(/\/$/, "")}/${basename}`;
      }
    }

    out.push({
      label,
      caption: rawCap,
      imagePath,
      pageIndex: (b.page_idx ?? 0) + 1, // store as 1-indexed (matches [Page N] convention)
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
