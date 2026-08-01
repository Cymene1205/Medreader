// Test the NEW 3-phase extractFiguresFromBlocks (with consecutive-block merging).
// Re-implemented inline (kept in sync with src/lib/extract-figures.ts).

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const MAIN_FIGURE_RE = /^\s*(?!.*(?:Supplementary|Extended\s+Data|\bS\d))(?:Fig(?:ure|\.)?)\s*(\d+)/i;
function normaliseFigureLabel(s) {
  if (!s) return null;
  const m = s.match(MAIN_FIGURE_RE);
  return m && m[1] ? `Figure ${m[1]}` : null;
}
function countPanels(c) {
  if (!c) return 0;
  const paren = c.match(/\(\s*([a-z])\s*\)/gi);
  if (paren && paren.length >= 2) {
    const letters = paren.map(p => p.replace(/[()]/g, '').trim().toLowerCase()).filter(c => /^[a-z]$/.test(c));
    if (letters.length > 0) return letters.reduce((m, c) => Math.max(m, c.charCodeAt(0) - 96), 0);
  }
  return 0;
}
function extractCaptionFromBlock(b) {
  const arrays = [];
  if (Array.isArray(b.chart_caption) && b.chart_caption.length > 0) arrays.push(b.chart_caption);
  if (Array.isArray(b.image_caption) && b.image_caption.length > 0) arrays.push(b.image_caption);
  if (arrays.length === 0) return null;
  let best = null;
  for (const arr of arrays) {
    for (const it of arr) {
      if (typeof it !== 'string') continue;
      const t = it.trim();
      if (t.length < 30 || /https?:\/\//i.test(t)) continue;
      if (normaliseFigureLabel(t) && (!best || t.length > best.length)) best = t;
    }
  }
  return best ? { caption: best, block: b } : null;
}

function extractFiguresFromBlocks(blocks, imagesDir) {
  const byLabel = new Map();
  let order = 0;
  const upsert = (label, caption, imgBlock, pageIndex) => {
    const ex = byLabel.get(label);
    if (ex) {
      if (caption.length > ex.caption.length) { ex.caption = caption; ex.panelCount = countPanels(caption); }
      if (!ex._imgBlock?.img_path && imgBlock?.img_path) ex._imgBlock = imgBlock;
      if (pageIndex < ex.pageIndex) ex.pageIndex = pageIndex;
      return;
    }
    byLabel.set(label, { label, caption, pageIndex, order: order++, panelCount: countPanels(caption), _imgBlock: imgBlock });
  };

  // Phase 1: group consecutive image/chart blocks on same page
  const candidates = [];
  let run = [], runPage = null, runStart = -1;
  const flush = () => {
    if (run.length > 0 && runPage !== null) {
      candidates.push({ blocks: run, pageIndex: runPage + 1, startIdx: runStart, endIdx: runStart + run.length - 1 });
    }
    run = []; runPage = null; runStart = -1;
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const isImg = b.type === 'image' || b.type === 'chart';
    const page = b.page_idx ?? 0;
    if (isImg) {
      if (runPage !== null && runPage !== page) flush();
      if (run.length === 0) runStart = i;
      run.push(b);
      runPage = page;
    } else {
      flush();
    }
  }
  flush();

  // Phase 2: per candidate, find caption
  for (const cand of candidates) {
    let best = null;
    for (let k = cand.blocks.length - 1; k >= 0; k--) {
      const m = extractCaptionFromBlock(cand.blocks[k]);
      if (m) { best = m; break; }
    }
    if (best) {
      const label = normaliseFigureLabel(best.caption);
      upsert(label, best.caption, best.block, cand.pageIndex);
      continue;
    }
    const lastBlock = cand.blocks[cand.blocks.length - 1];
    for (let j = cand.endIdx + 1; j <= Math.min(blocks.length - 1, cand.endIdx + 2); j++) {
      const nb = blocks[j];
      if (nb.type !== 'text') continue;
      const r = (typeof nb.text === 'string' ? nb.text : '').trim();
      if (!r || r.length < 30 || /https?:\/\//i.test(r)) continue;
      const label = normaliseFigureLabel(r);
      if (label) { upsert(label, r, lastBlock, cand.pageIndex); break; }
    }
  }

  // Phase 3: standalone text-block captions
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'text') continue;
    const r = (typeof b.text === 'string' ? b.text : '').trim();
    if (!r || r.length < 30 || /https?:\/\//i.test(r)) continue;
    const label = normaliseFigureLabel(r);
    if (!label) continue;
    const ex = byLabel.get(label);
    if (ex && ex.caption.length >= r.length) continue;
    let img = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const nb = blocks[j];
      if (nb.type === 'image' || nb.type === 'chart') { img = nb; break; }
      if (nb.type === 'text') {
        const pt = (nb.text || '').trim();
        if (/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(pt)) break;
        if (typeof nb.text_level === 'number' && nb.text_level === 1) break;
      }
    }
    if (!img) {
      for (let j = i + 1; j <= Math.min(blocks.length - 1, i + 2); j++) {
        const nb = blocks[j];
        if (nb.type === 'image' || nb.type === 'chart') { img = nb; break; }
      }
    }
    upsert(label, r, img, (b.page_idx ?? 0) + 1);
  }

  const out = [];
  for (const f of byLabel.values()) {
    let imagePath = null;
    if (f._imgBlock?.img_path && imagesDir) {
      const bn = f._imgBlock.img_path.replace(/^images\//, '').replace(/^\//, '').split('/').pop();
      if (bn) imagePath = `${imagesDir.replace(/\/$/, '')}/${bn}`;
    }
    out.push({ label: f.label, caption: f.caption, imagePath, pageIndex: f.pageIndex, panelCount: f.panelCount });
  }
  out.sort((a, b) => (parseInt(a.label.replace(/\D/g, '')) || 0) - (parseInt(b.label.replace(/\D/g, '')) || 0));
  out.forEach((f, i) => (f.order = i));
  return out;
}

const p = await prisma.paper.findFirst({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { blocksJson: true, imagesDir: true },
});
const blocks = JSON.parse(p.blocksJson || '[]');
const figs = extractFiguresFromBlocks(blocks, p.imagesDir);
console.log(`\n=== Extracted ${figs.length} figures (sorted by figure number) ===\n`);
for (const f of figs) {
  console.log(`${f.label} (page ${f.pageIndex}, panels=${f.panelCount}, hasImage=${!!f.imagePath})`);
  console.log(`  caption len=${f.caption.length}, first 120: ${f.caption.slice(0, 120)}`);
  console.log('');
}

// Also count image/chart blocks for reference
let imgBlockCount = 0;
for (const b of blocks) if (b.type === 'image' || b.type === 'chart') imgBlockCount++;
console.log(`(raw image/chart block count in this paper: ${imgBlockCount})`);
await prisma.$disconnect();
