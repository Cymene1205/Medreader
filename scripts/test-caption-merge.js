// Test the extendCaptionForward logic in isolation
const blocks = [
  { type: 'image', page_idx: 0, img_path: 'fig1.jpg' },
  { type: 'text',  page_idx: 0, text: 'Figure 1. Single-cell RNA sequencing reveals neutrophil heterogeneity after MI.' },
  { type: 'text',  page_idx: 0, text: 'Detailed experimental description showing how neutrophils were isolated from cardiac tissue and profiled using 10x Genomics scRNA-seq with paired CITE-seq antibody panels.' },
  { type: 'text',  page_idx: 0, text: 'Statistical analysis and quantification of cell populations across multiple timepoints (day 1, 3, 7, 14 post-MI).' },
  { type: 'text',  page_idx: 0, text: 'Methods Section', text_level: 1 },
  { type: 'text',  page_idx: 0, text: 'This is body text from the methods section, not part of the caption.' },
];

// Inline port of extendCaptionForward
function extendCaptionForward(startIdx, initialCaption, pageIdx) {
  const parts = [initialCaption];
  let totalLen = initialCaption.length;
  const MAX_BLOCKS = 20;
  const MAX_TOTAL_LEN = 4000;
  const startPage = pageIdx;
  for (let j = startIdx + 1; j <= Math.min(blocks.length - 1, startIdx + MAX_BLOCKS); j++) {
    const nb = blocks[j];
    if (!nb) break;
    if (nb.type === 'image' || nb.type === 'chart' || nb.type === 'table') break;
    if (typeof nb.text_level === 'number' && nb.text_level <= 2) break;
    if (nb.type !== 'text') break;
    const nbPage = nb.page_idx ?? startPage;
    if (nbPage > startPage + 1) break;
    const nbText = (typeof nb.text === 'string' ? nb.text : '').trim();
    if (!nbText) continue;
    if (/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(nbText)) break;
    if (/^\s*(?:Fig(?:ure|\.)?)\s*S\d+/i.test(nbText)) break;
    if (/^\s*Extended\s+Data\s+Fig/i.test(nbText)) break;
    if (/^\s*Supplementary\s+Fig/i.test(nbText)) break;
    if (/^\s*Table\s+\d+/i.test(nbText)) break;
    if (/^https?:\/\//i.test(nbText)) break;
    if (nbText.length <= 40 && !/[.,;:!?]$/.test(nbText) && /^[A-Z]/.test(nbText)) {
      if (!/^\(\s*[a-zA-Z]\s*\)/.test(nbText)) break;
    }
    parts.push(nbText);
    totalLen += nbText.length + 1;
    if (totalLen >= MAX_TOTAL_LEN) break;
  }
  return parts.join('\n');
}

// Test: starting at block idx 1 (the "Figure 1." text), should merge blocks 2 and 3
// but STOP at block 4 (which is an H1 heading "Methods Section")
const result = extendCaptionForward(1, blocks[1].text, 0);
console.log('=== Merged caption ===');
console.log(result);
console.log();
console.log('=== Length:', result.length, 'chars ===');
console.log('=== Should contain 3 paragraphs, end before "Methods Section" ===');
