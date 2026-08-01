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
   * Walk FORWARD from a caption's start block, merging subsequent text
   * blocks into the caption until we hit a stop condition. This fixes the
   * "only title is captured" issue where MinerU emits the figure caption
   * across multiple text blocks:
   *   Block N:   "Figure 1. Short title here"
   *   Block N+1: "Detailed experimental description spanning many lines..."
   *   Block N+2: "Statistical analysis and quantification..."
   *
   * Without this merge, only Block N is captured → user sees only the title.
   *
   * Stop conditions (any one stops the walk):
   *   - Next "Figure N" / "Fig. N" / "Supplementary Figure" pattern
   *   - H1/H2 heading (text_level === 1 or 2)
   *   - Image / chart / table block (next figure's content)
   *   - Page break (page_idx changes by more than 1 — the caption rarely
   *     spans more than one page; this avoids swallowing unrelated body
   *     text from later pages)
   *   - Length cap: stop after accumulating 4000 chars (safety net)
   *   - Block count cap: stop after 20 blocks (safety net)
   *
   * The merged caption is joined with "\n" to preserve paragraph breaks
   * for downstream markdown rendering.
   */
  const extendCaptionForward = (
    startIdx: number,
    initialCaption: string,
    pageIdx: number
  ): string => {
    const parts: string[] = [initialCaption];
    let totalLen = initialCaption.length;
    const MAX_BLOCKS = 20;
    const MAX_TOTAL_LEN = 4000;
    const startPage = pageIdx;

    for (let j = startIdx + 1; j <= Math.min(blocks.length - 1, startIdx + MAX_BLOCKS); j++) {
      const nb = blocks[j];
      if (!nb) break;

      // Stop on next figure / image / chart / table block
      if (nb.type === "image" || nb.type === "chart" || nb.type === "table") break;

      // Stop on headings — they mark a new section, not caption continuation
      if (typeof nb.text_level === "number" && nb.text_level <= 2) break;

      // Only merge text blocks (skip footers, page numbers, etc.)
      if (nb.type !== "text") break;

      // Stop on page break (caption rarely spans pages)
      const nbPage = nb.page_idx ?? startPage;
      if (nbPage > startPage + 1) break;

      const nbText = (typeof nb.text === "string" ? nb.text : "").trim();
      if (!nbText) continue;

      // Stop on next "Figure N" / "Fig. N" / "Figure S1" / "Extended Data" pattern
      if (/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(nbText)) break;
      if (/^\s*(?:Fig(?:ure|\.)?)\s*S\d+/i.test(nbText)) break;
      if (/^\s*Extended\s+Data\s+Fig/i.test(nbText)) break;
      if (/^\s*Supplementary\s+Fig/i.test(nbText)) break;
      if (/^\s*Table\s+\d+/i.test(nbText)) break;

      // Stop on URL-only lines (often TOC / citation noise)
      if (/^https?:\/\//i.test(nbText)) break;

      // Stop if the line looks like a new section heading even without
      // text_level (short, all-caps or title-case, ends with no period)
      // — these typically mark a new paragraph in the body, not caption text.
      // Heuristic: short line (<=40 chars) with no terminal punctuation.
      if (nbText.length <= 40 && !/[.,;:!?]$/.test(nbText) && /^[A-Z]/.test(nbText)) {
        // Could be either a panel label like "(A) UMAP plot" or a section
        // heading. Check: if it starts with a panel pattern (a), (b), etc.,
        // it's still caption text — keep it. Otherwise stop.
        if (!/^\(\s*[a-zA-Z]\s*\)/.test(nbText)) break;
      }

      // Looks like caption continuation — merge it.
      parts.push(nbText);
      totalLen += nbText.length + 1;
      if (totalLen >= MAX_TOTAL_LEN) break;
    }

    return parts.join("\n");
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
      // Non-image block — decide whether to flush or keep the run going.
      const rawText = (typeof b.text === "string" ? b.text : "").trim();

      // Determine if this text block is a "Figure N" caption — those
      // mark the START of a new figure and SHOULD flush.
      const isFigureCaption =
        rawText.length >= 30 &&
        /^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(rawText) &&
        !/https?:\/\//i.test(rawText);

      if (isFigureCaption) {
        // This is a new figure's caption — flush the previous run.
        flushRun();
      } else {
        // Otherwise it's a panel label / axis label / short description /
        // footnote — all of these are INTRA-figure noise that MinerU
        // sometimes emits between image blocks of the SAME figure.
        //
        // Critical: do NOT flush. This is what was causing "拆分小图"
        // (one Figure split into N candidates → N duplicate half-figures).
        //
        // EXCEPTION: if the page changed (curRunPage !== page) we still
        // need to flush — different page means different figure.
        if (curRunPage !== null && curRunPage !== page) {
          flushRun();
        }
        // Otherwise: skip this text block, keep growing the current run.
      }
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
  // LARGEST by bbox area (this is the composite / full-figure image);
  // require img_path to be present; fall back to the first block with
  // img_path if no block has a bbox.
  const pickBestImageBlock = (cand: { blocks: MinerUBlock[] }): MinerUBlock | null => {
    if (cand.blocks.length === 0) return null;
    // Only consider blocks that actually have an img_path — otherwise
    // we'd point at a block whose image file doesn't exist.
    const withPath = cand.blocks.filter((b) => b.img_path);
    if (withPath.length === 0) return null;
    let best = withPath[0];
    let bestArea = blockArea(best);
    for (let i = 1; i < withPath.length; i++) {
      const a = blockArea(withPath[i]);
      // Strictly greater — ties keep the earlier (top-most) block.
      if (a > bestArea) {
        best = withPath[i];
        bestArea = a;
      }
    }
    return best;
  };

  for (const cand of candidates) {
    // 2a: try caption from the LAST block (most common — caption attaches
    // to the last panel of a multi-panel figure).
    let bestMatch: { caption: string; block: MinerUBlock; blockIdx: number } | null = null;

    // Search from last block backwards — usually the caption is on the last
    // panel, but fall back to earlier blocks if the last one has no caption.
    for (let k = cand.blocks.length - 1; k >= 0; k--) {
      const m = extractCaptionFromBlock(cand.blocks[k]);
      if (m) {
        bestMatch = { ...m, blockIdx: cand.startIdx + k };
        break;
      }
    }

    if (bestMatch) {
      const label = normaliseFigureLabel(bestMatch.caption)!;
      // Use the LARGEST image block (full figure), not the caption-bearing
      // block (which might be just one panel).
      const displayBlock = pickBestImageBlock(cand) || bestMatch.block;
      // Walk forward from the caption's text block to merge any continuation
      // text blocks (MinerU often splits a caption's body across blocks).
      const startPage = bestMatch.block.page_idx ?? cand.pageIndex - 1;
      const mergedCaption = extendCaptionForward(bestMatch.blockIdx, bestMatch.caption, startPage);
      upsert(label, mergedCaption, displayBlock, cand.pageIndex);
      continue; // candidate handled
    }

    // 2b: Strategy B fallback — look at the next 1-2 blocks AFTER this
    // candidate. If a text block starts with "Figure N", use it as the
    // caption and pair with the LARGEST image block of this candidate.
    // Then walk FORWARD from there, merging subsequent text blocks into
    // the caption (fixes the "only title captured" issue — MinerU often
    // splits a caption's body across multiple text blocks).
    const largestBlock = pickBestImageBlock(cand);
    if (!largestBlock) {
      // No usable image block at all — skip this candidate.
      // (This avoids creating "figure" entries whose image won't render.)
      continue;
    }
    for (let j = cand.endIdx + 1; j <= Math.min(blocks.length - 1, cand.endIdx + 2); j++) {
      const nb = blocks[j];
      if (nb.type !== "text") continue;
      const rawCap = (typeof nb.text === "string" ? nb.text : "").trim();
      if (!rawCap || rawCap.length < 30) continue;
      if (/https?:\/\//i.test(rawCap)) continue;
      const label = normaliseFigureLabel(rawCap);
      if (label) {
        // Found the caption's starting block. Walk forward to merge any
        // continuation text blocks into one complete caption string.
        const mergedCaption = extendCaptionForward(j, rawCap, nb.page_idx ?? cand.pageIndex - 1);
        upsert(label, mergedCaption, largestBlock, cand.pageIndex);
        break;
      }
    }
    // If still no caption found: this candidate is just an image without
    // any caption info — skip it. We'd rather miss a figure than create a
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

    // Merge subsequent caption continuation blocks BEFORE comparing to
    // the existing entry — otherwise a "title-only" caption would always
    // lose to an existing entry, even though the merged version is longer.
    const mergedCap = extendCaptionForward(i, rawCap, b.page_idx ?? 0);

    // If we already have this label with a caption at least as long, skip.
    const existing = byLabel.get(label);
    if (existing && existing.caption.length >= mergedCap.length) continue;

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

    upsert(label, mergedCap, imgBlock, (b.page_idx ?? 0) + 1);
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
