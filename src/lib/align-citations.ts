/**
 * Citation alignment — extracts in-text figure references from the paper's
 * parsed text/markdown, and aligns each one to:
 *   - the figure label it references (e.g. "Figure 3")
 *   - the panel letters it covers (e.g. ["A", "B", "C"])
 *   - the sentence that contains the reference
 *   - the page index (1-indexed, inferred from "[Page N]" markers)
 *   - whether it's a supplementary figure (Fig. S, Extended Data)
 *
 * Output is stored on Paper.citationsJson as an array of:
 *   { figureLabel, panels[], sentence, pageIndex, isSupp }
 *
 * Used by:
 *   - /api/figures  — to feed each figure's "citingSentences" into the
 *     batch LLM prompt so the model can derive the per-figure `question`
 *     from the surrounding sentence, not just the caption.
 *   - figure-chain.tsx (frontend) — when the user clicks a panel chip,
 *     we use the first matching citation's sentence as the `quote` for
 *     the PDF-jump-highlight mechanism (re-uses the existing quote system).
 *
 * This is pure-code regex — no LLM calls.
 *
 * Public entry point: buildCitationsAndStore(paperId)
 */

import { db } from "@/lib/db";

export type Citation = {
  figureLabel: string; // "Figure 3" (normalised) or "Figure S1" / "Extended Data Figure 1" if isSupp
  panels: string[]; // ["A", "B", "C"] — uppercased, de-ranged
  sentence: string; // the full sentence containing the reference
  pageIndex: number; // 1-indexed page (from [Page N] markers); 0 if unknown
  isSupp: boolean;
};

/**
 * Match figure references in scientific text. Covers:
 *   (Fig. 3a)        — parenthesised, single panel
 *   (Fig. 3A–C)      — parenthesised, panel range
 *   (Fig. 3A-C)      — hyphen variant
 *   (Fig. 3A, B)     — comma list
 *   (Figs. 3a and 4b)— multiple figures in one paren
 *   Figure 2A-C      — bare, no parens
 *   Fig. 2B–2D       — bare, with figure-number ranges
 *   (see Fig. 3)     — with leading "see"
 *   (Fig. 3a, b, d)  — comma list with mixed single letters
 *
 * Also captures supplementary variants:
 *   Fig. S1, Figure S1, Extended Data Figure 1, Supplementary Figure 2
 *
 * NOT matched (intentionally):
 *   - "fig." alone without a number (false positives in methodology text)
 *   - "Fig. 1" inside the figure's own caption (handled by caller — we
 *     only feed body text, never captions, into this function)
 */
const CITATION_RE =
  /(?:(?:Fig(?:ure|s|\.)?|Extended\s+Data\s+Figure|Supplementary\s+Figure)\s*S?\d+(?:[A-Za-z,\s\u2013\-–—andand]+)?)/gi;

/**
 * Walk the text and produce a stream of (charOffset, [Page N] markers).
 * We need this so we can compute the pageIndex for any citation by
 * looking at the last "[Page N]" marker that appears before it.
 *
 * The text format from MinerU/markdown is:
 *   ...
 *   [Page 3]
 *   ...body text of page 3...
 *   [Page 4]
 *   ...body text of page 4...
 *   ...
 */
function buildPageIndexMap(text: string): Array<{ offset: number; page: number }> {
  const map: Array<{ offset: number; page: number }> = [];
  const re = /\[Page\s+(\d+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    map.push({ offset: m.index, page: parseInt(m[1], 10) });
  }
  return map;
}

function pageAtOffset(
  map: Array<{ offset: number; page: number }>,
  offset: number
): number {
  // Find the largest offset <= the citation's offset
  let page = 0;
  for (const { offset: o, page: p } of map) {
    if (o <= offset) page = p;
    else break;
  }
  return page;
}

/**
 * Extract the sentence containing the citation. Sentence boundaries are
 * ". ", "! ", "? " followed by a capital letter, OR end of text. We also
 * treat newlines as soft boundaries when they're preceded by sentence
 * punctuation.
 *
 * Returns a trimmed snippet (max 300 chars — keeps LLM prompt small).
 */
function sentenceAround(text: string, offset: number): string {
  // Walk back to find sentence start
  let start = 0;
  for (let i = offset - 1; i > 0; i--) {
    const c = text[i];
    const prev = text[i - 1] || "";
    if (
      (prev === "." || prev === "!" || prev === "?") &&
      /\s/.test(c) &&
      /[A-Z\u4e00-\u9fff]/.test(text[i + 1] || "")
    ) {
      start = i + 1;
      break;
    }
    if (c === "\n" && i < offset - 1 && /[.!?\n]/.test(text[i - 1] || "")) {
      start = i + 1;
      break;
    }
  }
  // Walk forward to find sentence end
  let end = text.length;
  for (let i = offset + 1; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1] || "";
    if ((c === "." || c === "!" || c === "?") && (/\s/.test(next) || next === "")) {
      end = i + 1;
      break;
    }
  }
  const snippet = text.slice(start, end).trim();
  // Cap length — long methodology sentences can be 1000+ chars
  return snippet.length > 300 ? snippet.slice(0, 300) + "…" : snippet;
}

/**
 * Parse a panel string like "3A–C", "3A, B", "2B–2D", "3a, b, d" into
 * an array of uppercase single-letter panels: ["A", "B", "C"].
 *
 * For ranges like "3A–C", expands A,B,C.
 * For ranges like "2B–2D", expands B,C,D (ignores the "2" prefix).
 * Returns [] if no panels are mentioned (whole-figure reference).
 */
function parsePanels(panelStr: string): string[] {
  const panels = new Set<string>();
  // Match letter ranges like "A-C" / "A–C" / "A—C"
  const rangeRe = /([A-Za-z])\s*[–\-—]\s*([A-Za-z])/g;
  let m: RegExpExecArray | null;
  let working = panelStr;
  // First, expand ranges
  const expanded: string[] = [];
  let lastIdx = 0;
  while ((m = rangeRe.exec(working)) !== null) {
    expanded.push(working.slice(lastIdx, m.index));
    const start = m[1].toUpperCase().charCodeAt(0) - 64;
    const end = m[2].toUpperCase().charCodeAt(0) - 64;
    if (start > 0 && end >= start && end - start < 26) {
      for (let i = start; i <= end; i++) {
        expanded.push(String.fromCharCode(64 + i));
      }
    } else {
      expanded.push(m[1].toUpperCase(), m[2].toUpperCase());
    }
    lastIdx = m.index + m[0].length;
  }
  expanded.push(working.slice(lastIdx));
  working = expanded.join(" ");

  // Now pick out individual letters, ignoring the figure number
  const letterRe = /\b([A-Za-z])\b/g;
  while ((m = letterRe.exec(working)) !== null) {
    const letter = m[1].toUpperCase();
    // Skip "and" / "or" / "to" — they wouldn't match \b[A-Za-z]\b anyway
    // because those are multi-char words. But just in case, skip A-Z that
    // appear right after a digit (those are panel letters) — actually we
    // want to KEEP those. So just add everything.
    if (/^[A-Z]$/.test(letter)) panels.add(letter);
  }

  return Array.from(panels).sort();
}

/**
 * Normalise a raw match like "Fig. 3a", "Figs. 3a and 4b", "Extended Data Figure 1"
 * into an array of { label, isSupp, panels } entries — because "Figs. 3a and 4b"
 * expands to TWO references.
 */
function expandMatch(raw: string): Array<{
  label: string;
  isSupp: boolean;
  panels: string[];
}> {
  const out: Array<{ label: string; isSupp: boolean; panels: string[] }> = [];
  const trimmed = raw.trim();

  // Detect supplementary
  const isSupp =
    /\bS\d/i.test(trimmed) ||
    /Extended\s+Data/i.test(trimmed) ||
    /Supplementary/i.test(trimmed);

  // Strip "Extended Data" / "Supplementary" prefixes for label normalisation
  const cleaned = trimmed
    .replace(/Extended\s+Data\s+/gi, "")
    .replace(/Supplementary\s+/gi, "");

  // Pattern: "Figs?.?\s*(\d+)([A-Za-z,\s\u2013\-–—and]+)?"  -- main figure
  //          "Figure\s*S(\d+)"                              -- supp figure
  // We split on "and" / "," to handle multi-figure refs like "Figs. 3a and 4b"
  const figRe =
    /Fig(?:ure|s|\.)?\s*(S?\d+)\s*([A-Za-z,\s\u2013\-–—and]+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = figRe.exec(cleaned)) !== null) {
    const numStr = m[1];
    const panelStr = m[2] || "";
    const isThisSupp = isSupp || /^S/i.test(numStr);
    const num = numStr.replace(/^S/i, "");
    const label = isThisSupp ? `Figure S${num}` : `Figure ${num}`;
    const panels = parsePanels(panelStr);
    out.push({ label, isSupp: isThisSupp, panels });
  }

  return out;
}

/**
 * Public: walk the paper's markdown (preferred) or parsedText, extract all
 * figure references, and persist to Paper.citationsJson.
 *
 * Returns the array of citations (also written to DB).
 */
export async function buildCitationsAndStore(
  paperId: string
): Promise<Citation[]> {
  const paper = await db.paper.findUnique({
    where: { id: paperId },
    select: { markdown: true, parsedText: true },
  });
  if (!paper) return [];

  // Prefer markdown (MinerU) — it has clean "[Page N]" markers preserved
  // and is more faithful to the original layout. Fall back to parsedText
  // (pdfjs) which has the same markers but messier text.
  const source = paper.markdown || paper.parsedText || "";
  if (!source) return [];

  const citations = extractCitations(source);
  if (citations.length === 0) return [];

  await db.paper.update({
    where: { id: paperId },
    data: { citationsJson: JSON.stringify(citations) },
  });

  return citations;
}

/**
 * Pure function: walk text and extract all citations.
 * Exported for testing and for callers that already have the text in memory.
 */
export function extractCitations(text: string): Citation[] {
  if (!text) return [];
  const pageMap = buildPageIndexMap(text);
  const out: Citation[] = [];
  let m: RegExpExecArray | null;
  // Reset regex stateful globals
  const re = new RegExp(CITATION_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const offset = m.index;
    const expanded = expandMatch(raw);
    const sentence = sentenceAround(text, offset);
    const page = pageAtOffset(pageMap, offset);
    for (const e of expanded) {
      out.push({
        figureLabel: e.label,
        panels: e.panels,
        sentence,
        pageIndex: page,
        isSupp: e.isSupp,
      });
    }
  }
  return out;
}

/**
 * Helper for /api/figures: given all citations for a paper, group by
 * figureLabel and return only the non-supp citations for each main figure.
 * Returns a map: { "Figure 1": string[], "Figure 2": string[], ... }
 *
 * Each entry is the deduplicated list of citing sentences, in document order.
 */
export function groupCitationsByFigure(
  citations: Citation[],
  mainFigureLabels: Set<string>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const label of mainFigureLabels) out[label] = [];
  for (const c of citations) {
    if (c.isSupp) continue;
    if (!mainFigureLabels.has(c.figureLabel)) continue;
    if (!out[c.figureLabel]) out[c.figureLabel] = [];
    // Dedupe by sentence (case-insensitive) — same sentence often cites
    // multiple panels of the same figure, we only need it once.
    const lower = c.sentence.toLowerCase();
    if (out[c.figureLabel].some((s) => s.toLowerCase() === lower)) continue;
    out[c.figureLabel].push(c.sentence);
  }
  return out;
}
