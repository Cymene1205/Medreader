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

  // Strategy A — BOTH chart_caption AND image_caption are arrays now
  for (const b of blocks) {
    if (b.type !== 'image' && b.type !== 'chart') continue;
    const captionArrays = [];
    if (Array.isArray(b.chart_caption) && b.chart_caption.length > 0) captionArrays.push(b.chart_caption);
    if (Array.isArray(b.image_caption) && b.image_caption.length > 0) captionArrays.push(b.image_caption);
    if (captionArrays.length === 0) continue;
    for (const arr of captionArrays) {
      for (const capItem of arr) {
        if (typeof capItem !== 'string') continue;
        const t = capItem.trim();
        if (t.length < 30) continue;
        if (/https?:\/\//i.test(t)) continue;
        const label = normaliseFigureLabel(t);
        if (label) { upsert(label, t, b, (b.page_idx ?? 0) + 1); break; }
      }
    }
  }

  // Strategy B
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'text') continue;
    const rawCap = (typeof b.text === 'string' ? b.text : '').trim();
    if (!rawCap || rawCap.length < 30) continue;
    if (/https?:\/\//i.test(rawCap)) continue;
    const label = normaliseFigureLabel(rawCap);
    if (!label) continue;
    let imgBlock = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const nb = blocks[j];
      if (nb.type === 'image' || nb.type === 'chart') { imgBlock = nb; break; }
      if (nb.type === 'text') {
        const pt = (nb.text || '').trim();
        if (/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(pt)) break;
        if (typeof nb.text_level === 'number' && nb.text_level === 1) break;
      }
    }
    if (!imgBlock) {
      for (let j = i + 1; j <= Math.min(blocks.length - 1, i + 2); j++) {
        const nb = blocks[j];
        if (nb.type === 'image' || nb.type === 'chart') { imgBlock = nb; break; }
      }
    }
    upsert(label, rawCap, imgBlock, (b.page_idx ?? 0) + 1);
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

const p = await prisma.paper.findFirst({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { blocksJson: true, imagesDir: true },
});
const blocks = JSON.parse(p.blocksJson || '[]');
const figs = extractFiguresFromBlocks(blocks, p.imagesDir);
console.log(`\n=== Extracted ${figs.length} figures from vafadarnejad ===\n`);
for (const f of figs) {
  console.log(`${f.label} (page ${f.pageIndex}, panels=${f.panelCount}, hasImage=${!!f.imagePath})`);
  console.log(`  caption: ${f.caption.slice(0, 150)}${f.caption.length > 150 ? '...' : ''}`);
  console.log('');
}
await prisma.$disconnect();
