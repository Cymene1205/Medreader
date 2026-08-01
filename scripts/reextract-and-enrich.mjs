// Re-extract figures for an existing paper using the new dual-strategy
// extractor, then trigger Call A + argumentSpine via /api/figures.

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
function extractFiguresFromBlocks(blocks, imagesDir) {
  const byLabel = new Map();
  let order = 0;
  const upsert = (label, caption, imgBlock, pageIndex) => {
    const existing = byLabel.get(label);
    if (existing) {
      if (caption.length > existing.caption.length) existing.caption = caption;
      if (!existing._imgBlock?.img_path && imgBlock?.img_path) existing._imgBlock = imgBlock;
      return;
    }
    byLabel.set(label, { label, caption, pageIndex, order: order++, panelCount: countPanels(caption), _imgBlock: imgBlock });
  };
  for (const b of blocks) {
    if (b.type !== 'image' && b.type !== 'chart') continue;
    const arrays = [];
    if (Array.isArray(b.chart_caption) && b.chart_caption.length > 0) arrays.push(b.chart_caption);
    if (Array.isArray(b.image_caption) && b.image_caption.length > 0) arrays.push(b.image_caption);
    for (const arr of arrays) {
      for (const it of arr) {
        if (typeof it !== 'string') continue;
        const t = it.trim();
        if (t.length < 30 || /https?:\/\//i.test(t)) continue;
        const label = normaliseFigureLabel(t);
        if (label) { upsert(label, t, b, (b.page_idx ?? 0) + 1); break; }
      }
    }
  }
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'text') continue;
    const r = (typeof b.text === 'string' ? b.text : '').trim();
    if (!r || r.length < 30 || /https?:\/\//i.test(r)) continue;
    const label = normaliseFigureLabel(r);
    if (!label) continue;
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
  out.sort((a, b) => a.pageIndex - b.pageIndex || parseInt(a.label.replace(/\D/g, '')) - parseInt(b.label.replace(/\D/g, '')));
  out.forEach((f, i) => (f.order = i));
  return out;
}

// Find latest vafadarnejad paper
const paper = await prisma.paper.findFirst({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { id: true, title: true, blocksJson: true, imagesDir: true },
});
if (!paper) { console.log('paper not found'); process.exit(1); }
console.log('paper:', paper.id, paper.title.slice(0, 60));

const blocks = JSON.parse(paper.blocksJson || '[]');
const figs = extractFiguresFromBlocks(blocks, paper.imagesDir);
console.log(`extracted ${figs.length} figures`);

// Delete existing figures (idempotent) and re-insert
await prisma.figure.deleteMany({ where: { paperId: paper.id } });
await prisma.figure.createMany({
  data: figs.map(f => ({
    paperId: paper.id,
    label: f.label,
    caption: f.caption,
    imagePath: f.imagePath,
    pageIndex: f.pageIndex,
    order: f.order,
    panelCount: f.panelCount,
  })),
});
console.log(`wrote ${figs.length} Figure rows to DB (question/role/isLinchpin all null — Call A will fill)`);

// Also clear the stale argumentSpine from analysisJson so the frontend
// re-runs the spine after Call A completes.
const existing = await prisma.paper.findUnique({ where: { id: paper.id }, select: { analysisJson: true } });
if (existing?.analysisJson) {
  try {
    const a = JSON.parse(existing.analysisJson);
    if (a.argumentSpine) {
      a.argumentSpine = null;
      a.failedParts = (a.failedParts || []).filter(p => p !== 'argumentSpine');
      await prisma.paper.update({ where: { id: paper.id }, data: { analysisJson: JSON.stringify(a) } });
      console.log('cleared stale argumentSpine from analysisJson');
    }
  } catch (e) { console.log('analysisJson parse failed, leaving as-is'); }
}

await prisma.$disconnect();
console.log('\nNext step: POST /api/figures with paperId to trigger Call A + spine.');
