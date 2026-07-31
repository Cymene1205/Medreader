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
 * one with the nearest image/chart block (or group of blocks).
 *
 * Pure function — no DB. Returns the figures in document order.
 *
 * ⚠️ MINERU REALITY — figures come in THREE shapes:
 *
 *   Shape 1 — ONE chart/image block holds the WHOLE figure (multi-panel composite).
 *     The block's chart_caption / image_caption field has the full caption.
 *     Most common case.
 *
 *   Shape 2 — N adjacent image/chart blocks (each is one panel) share ONE caption
 *     that's attached to the LAST block's caption field (or to a separate text
 *     block right after the last image). MinerU splits the figure visually but
 *     the caption refers to all panels together. We MUST merge these into ONE
 *     figure row, otherwise we'd show N broken half-figures.
 *
 *   Shape 3 — caption is a separate text block, image blocks have empty caption
 *     fields. Rare. We pair the text caption with the nearest preceding image block.
 *
 * ALGORITHM:
 *   1. Walk blocks, group CONSECUTIVE image/chart blocks on the SAME page into
 *      "figure candidates". A text block (esp. caption or H1) breaks the run.
 *   2. For each candidate, look for a caption in:
 *        a) The LAST image/chart block's chart_caption / image_caption arrays
 *           (the caption usually attaches to the last panel).
 *        b) The FIRST chart/image block's caption arrays (sometimes attached
 *           to the first panel).
 *        c) The next text block immediately after the candidate (Strategy B
 *           fallback for Shape 3).
 *   3. Pick the longest "Figure N" caption found across all sources.
 *   4. The imagePath comes from the block whose caption array contained the
 *      matched "Figure N" item — that's the most representative panel.
 *      If none of the blocks had a caption (rare), use the FIRST block's
 *      img_path so we at least show something.
 *   5. caption-only records (no paired image) are still kept.
 *
 * Both `chart_caption` and `image_caption` are ARRAYS of strings in MinerU vlm
 * output — the real caption is the array item that starts with "Figure N",
 * earlier items are panel labels (A, B, G, ...).
 */
export function extractFiguresFromBlocks(
  blocks: MinerUBlock[],
  imagesDir: string | null
): ExtractedFigure[] {
  // Intermediate map keyed by label — lets us dedup across candidates.
  const byLabel = new Map<string, ExtractedFigure & { _imgBlock?: MinerUBlock | null }>();
  let order = 0;

  const upsert = (
    label: string,
    caption: string,
    imgBlock: MinerUBlock | null,
    pageIndex: number
  ) => {
    const existing = byLabel.get(label);
    if (existing) {
      // Prefer the longer caption (more info for Call A).
      if (caption.length > existing.caption.length) {
        existing.caption = caption;
        existing.panelCount = countPanels(caption);
      }
      // Prefer the entry that actually has an image block paired.
      if (!existing._imgBlock?.img_path && imgBlock?.img_path) {
        existing._imgBlock = imgBlock;
      }
      // Prefer the smaller page index (caption usually appears on the page
      // where the figure STARTS, not ends — for multi-page spreads).
      if (pageIndex < existing.pageIndex) existing.pageIndex = pageIndex;
      return;
    }
    byLabel.set(label, {
      label,
      caption,
      imagePath: null, // resolved below from _imgBlock
      pageIndex,
      order: order++,
      panelCount: countPanels(caption),
      _imgBlock: imgBlock,
    });
  };

  /**
   * Pull the longest "Figure N" caption out of a chart_caption / image_caption
   * array. Returns { caption, block } so we know which block holds the image
   * that matches the caption (we'll use that block's img_path).
   */
  const extractCaptionFromBlock = (
    b: MinerUBlock
  ): { caption: string; block: MinerUBlock } | null => {
    const captionArrays: string[][] = [];
    if (Array.isArray(b.chart_caption) && b.chart_caption.length > 0) {
      captionArrays.push(b.chart_caption);
    }
    if (Array.isArray(b.image_caption) && b.image_caption.length > 0) {
      captionArrays.push(b.image_caption);
    }
    if (captionArrays.length === 0) return null;

    let bestCaption: string | null = null;
    for (const arr of captionArrays) {
      for (const capItem of arr) {
        if (typeof capItem !== "string") continue;
        const trimmed = capItem.trim();
        if (trimmed.length < 30) continue; // skip panel labels like "G", "A, B, C"
        if (/https?:\/\//i.test(trimmed)) continue; // skip TOC entries
        const label = normaliseFigureLabel(trimmed);
        if (!label) continue;
        // Among multiple "Figure N" matches (rare), keep the longest caption.
        if (!bestCaption || trimmed.length > bestCaption.length) {
          bestCaption = trimmed;
        }
      }
    }
    if (!bestCaption) return null;
    return { caption: bestCaption, block: b };
  };

  // ────────────────────────────────────────────────────────────────────────
  // Phase 1: walk blocks, group consecutive image/chart blocks on the same
  // page into "figure candidates". A text block (caption / heading) or a
  // page change breaks the run.
  // ────────────────────────────────────────────────────────────────────────
  type FigureCandidate = {
    blocks: MinerUBlock[]; // 1+ consecutive image/chart blocks (same page)
    pageIndex: number; // 1-indexed
    startIdx: number; // first block idx in `blocks`
    endIdx: number; // last block idx in `blocks`
  };

  const candidates: FigureCandidate[] = [];
  let curRun: MinerUBlock[] = [];
  let curRunPage: number | null = null;
  let curRunStart = -1;

  const flushRun = () => {
    if (curRun.length > 0 && curRunPage !== null) {
      candidates.push({
        blocks: curRun,
        pageIndex: curRunPage + 1, // 1-indexed
        startIdx: curRunStart,
        endIdx: curRunStart + curRun.length - 1,
      });
    }
    curRun = [];
    curRunPage = null;
    curRunStart = -1;
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const isImg = b.type === "image" || b.type === "chart";
    const page = b.page_idx ?? 0;

    if (isImg) {
      // Continue the run if same page; otherwise flush and start a new run.
      if (curRunPage !== null && curRunPage !== page) {
        flushRun();
      }
      if (curRun.length === 0) curRunStart = i;
      curRun.push(b);
      curRunPage = page;
    } else {
      // Non-image block — by default flush the current run.
      // BUT: if this text block is a short panel label like "(A) ...",
      // "(B) ...", "a,", "b,", or a single letter/digit, AND the next
      // non-text block is also an image/chart on the same page, we treat
      // it as an intra-figure label and DO NOT flush. This is critical
      // for multi-panel figures where MinerU emits panel labels as
      // separate text blocks BETWEEN image blocks (which would otherwise
      // split one Figure into N candidates → N duplicate half-figures).
      const rawText = (typeof b.text === "string" ? b.text : "").trim();
      const isPanelLabel =
        rawText.length > 0 &&
        rawText.length < 80 && // short
        // matches "(A)", "(B)", "（A）", "A.", "a)", "A:", "(a,b)", "(A–C)", etc.
        /^\s*[\(（]?[A-Za-z](?:\s*[,，\-–]\s*[A-Za-z])*\s*[\)）]?\s*[:：.\-、]?/.test(rawText) &&
        // exclude real captions ("Figure 1 ...", "Fig. 2 ...")
        !/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(rawText);

      if (isPanelLabel && curRunPage === page) {
        // Peek ahead: is the next non-text block an image on the same page?
        let nextImgIdx = -1;
        for (let j = i + 1; j < Math.min(blocks.length, i + 4); j++) {
          const nb = blocks[j];
          if (nb.type === "image" || nb.type === "chart") {
            nextImgIdx = j;
            break;
          }
          // If we hit another non-image block that's NOT a panel label, stop.
          const nbText = (typeof nb.text === "string" ? nb.text : "").trim();
          const nbIsPanel =
            nbText.length > 0 &&
            nbText.length < 80 &&
            /^\s*[\(（]?[A-Za-z](?:\s*[,，\-–]\s*[A-Za-z])*\s*[\)）]?\s*[:：.\-、]?/.test(nbText) &&
            !/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(nbText);
          if (!nbIsPanel) break;
        }
        if (nextImgIdx !== -1 && (blocks[nextImgIdx].page_idx ?? 0) === page) {
          // Skip this panel label — don't flush. Continue the run.
          continue;
        }
      }

      // Special case: if this text block is a "Figure N" caption (Shape 3),
      // we DON'T want to merge it with the next image run. The flush below
      // already handles that correctly.
      flushRun();
    }
  }
  flushRun();

  // ────────────────────────────────────────────────────────────────────────
  // Phase 2: for each candidate, find the best caption + representative
  // image block. Emit one ExtractedFigure per candidate.
  //
  // IMPORTANT: when a candidate has multiple image blocks (multi-panel
  // figure that MinerU split into pieces), we pick the LARGEST image block
  // by bbox area — this is almost always the "full figure" view (the first
  // panel typically contains the composite image). Picking the block that
  // holds the caption (usually the LAST block) would show only the last
  // panel, which is exactly the "拆分小图" problem the user reported.
  // ────────────────────────────────────────────────────────────────────────

  // Helper: estimate image block area from bbox (returns 0 if no bbox).
  const blockArea = (b: MinerUBlock): number => {
    if (!b.bbox || b.bbox.length !== 4) return 0;
    const [x1, y1, x2, y2] = b.bbox;
    return Math.abs((x2 - x1) * (y2 - y1));
  };

  // Helper: pick the "best" image block from a candidate — prefer the
  // largest by bbox area; fall back to the first block if areas are 0.
  const pickBestImageBlock = (cand: { blocks: MinerUBlock[] }): MinerUBlock | null => {
    if (cand.blocks.length === 0) return null;
    let best = cand.blocks[0];
    let bestArea = blockArea(best);
    for (let i = 1; i < cand.blocks.length; i++) {
      const a = blockArea(cand.blocks[i]);
      // Strictly greater — ties keep the earlier (top-most) block.
      if (a > bestArea) {
        best = cand.blocks[i];
        bestArea = a;
      }
    }
    return best;
  };

  for (const cand of candidates) {
    // 2a: try caption from the LAST block (most common — caption attaches
    // to the last panel of a multi-panel figure).
    let bestMatch: { caption: string; block: MinerUBlock } | null = null;

    // Search from last block backwards — usually the caption is on the last
    // panel, but fall back to earlier blocks if the last one has no caption.
    for (let k = cand.blocks.length - 1; k >= 0; k--) {
      const m = extractCaptionFromBlock(cand.blocks[k]);
      if (m) {
        bestMatch = m;
        break;
      }
    }

    if (bestMatch) {
      const label = normaliseFigureLabel(bestMatch.caption)!;
      // Use the LARGEST image block (full figure), not the caption-bearing
      // block (which might be just one panel).
      const displayBlock = pickBestImageBlock(cand) || bestMatch.block;
      upsert(label, bestMatch.caption, displayBlock, cand.pageIndex);
      continue; // candidate handled
    }

    // 2b: Strategy B fallback — look at the next 1-2 blocks AFTER this
    // candidate. If a text block starts with "Figure N", use it as the
    // caption and pair with the LARGEST image block of this candidate.
    const largestBlock = pickBestImageBlock(cand) || cand.blocks[cand.blocks.length - 1];
    for (let j = cand.endIdx + 1; j <= Math.min(blocks.length - 1, cand.endIdx + 2); j++) {
      const nb = blocks[j];
      if (nb.type !== "text") continue;
      const rawCap = (typeof nb.text === "string" ? nb.text : "").trim();
      if (!rawCap || rawCap.length < 30) continue;
      if (/https?:\/\//i.test(rawCap)) continue;
      const label = normaliseFigureLabel(rawCap);
      if (label) {
        upsert(label, rawCap, largestBlock, cand.pageIndex);
        break;
      }
    }
    // If still no caption found: this candidate is just a panel with no
    // caption info — skip it. We'd rather miss a figure than create a
    // duplicate / half-figure entry. (Captions from citations in Call A
    // can still pick these up if needed.)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Phase 3: Strategy B standalone — scan text blocks whose content starts
  // with "Figure N" that we haven't already paired via Phase 2.
  // Covers: caption text blocks far from any image block, or where the
  // image blocks were absorbed into a different figure candidate.
  // ────────────────────────────────────────────────────────────────────────
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "text") continue;
    const rawCap = (typeof b.text === "string" ? b.text : "").trim();
    if (!rawCap || rawCap.length < 30) continue;
    if (/https?:\/\//i.test(rawCap)) continue;
    const label = normaliseFigureLabel(rawCap);
    if (!label) continue;

    // If we already have this label with a caption at least as long, skip.
    const existing = byLabel.get(label);
    if (existing && existing.caption.length >= rawCap.length) continue;

    // Look BACKWARD (up to 5 blocks) for the nearest image/chart block.
    let imgBlock: MinerUBlock | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const nb = blocks[j];
      if (nb.type === "image" || nb.type === "chart") {
        imgBlock = nb;
        break;
      }
      if (nb.type === "text") {
        const prevText = (nb.text || "").trim();
        if (/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(prevText)) break;
        if (typeof nb.text_level === "number" && nb.text_level === 1) break;
      }
    }

    // Fallback: look FORWARD (up to 2 blocks).
    if (!imgBlock) {
      for (let j = i + 1; j <= Math.min(blocks.length - 1, i + 2); j++) {
        const nb = blocks[j];
        if (nb.type === "image" || nb.type === "chart") {
          imgBlock = nb;
          break;
        }
      }
    }

    upsert(label, rawCap, imgBlock, (b.page_idx ?? 0) + 1);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Final pass: resolve imagePath from the paired image block.
  // ────────────────────────────────────────────────────────────────────────
  const out: ExtractedFigure[] = [];
  for (const f of byLabel.values()) {
    let imagePath: string | null = null;
    if (f._imgBlock?.img_path && imagesDir) {
      const cleanName = f._imgBlock.img_path
        .replace(/^images\//, "")
        .replace(/^\//, "");
      const basename = cleanName.split("/").pop();
      if (basename) {
        imagePath = `${imagesDir.replace(/\/$/, "")}/${basename}`;
      }
    }
    out.push({
      label: f.label,
      caption: f.caption,
      imagePath,
      pageIndex: f.pageIndex,
      order: f.order,
      panelCount: f.panelCount,
    });
  }

  // Sort by FIGURE NUMBER (Figure 1 → 2 → 3 ...), NOT by chainIndex.
  // chainIndex is the LLM-assigned "argument-chain order" which may differ
  // from document order; the figure LIST should always be in numeric order.
  out.sort((a, b) => {
    const an = parseInt(a.label.replace(/\D/g, ""), 10) || 0;
    const bn = parseInt(b.label.replace(/\D/g, ""), 10) || 0;
    return an - bn;
  });
  // Reassign order based on sorted position.
  out.forEach((f, i) => (f.order = i));

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
