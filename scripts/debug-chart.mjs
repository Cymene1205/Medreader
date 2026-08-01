import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const p = await prisma.paper.findFirst({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { blocksJson: true },
});
const blocks = JSON.parse(p.blocksJson || '[]');

const MAIN_FIGURE_RE = /^\s*(?!.*(?:Supplementary|Extended\s+Data|\bS\d))(?:Fig(?:ure|\.)?)\s*(\d+)/i;

console.log('=== All chart/image blocks with chart_caption containing "Figure" ===');
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  const cap = b.chart_caption;
  if (!cap || typeof cap !== 'string') continue;
  if (!/fig/i.test(cap)) continue;
  const m = cap.match(MAIN_FIGURE_RE);
  console.log(`[idx=${i}] type=${b.type} page=${b.page_idx}`);
  console.log(`  chart_caption (first 120 chars): ${cap.slice(0, 120)}`);
  console.log(`  length: ${cap.length}`);
  console.log(`  startsWithFigure: ${/^\s*fig/i.test(cap)}`);
  console.log(`  regexMatch: ${m ? `Figure ${m[1]}` : 'NO MATCH'}`);
  if (!m) {
    // debug: show what chars are at the start
    console.log(`  first 10 char codes:`, cap.slice(0, 10).split('').map(c => c.charCodeAt(0)));
  }
  console.log('');
}

// Also show image_caption arrays
console.log('=== All image blocks with image_caption array containing "Figure" ===');
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (!Array.isArray(b.image_caption) || b.image_caption.length === 0) continue;
  const hasFig = b.image_caption.some(s => /fig/i.test(s || ''));
  if (!hasFig) continue;
  console.log(`[idx=${i}] type=${b.type} page=${b.page_idx}`);
  console.log(`  image_caption array:`);
  for (const item of b.image_caption) {
    const m = (item || '').match(MAIN_FIGURE_RE);
    console.log(`    [${item?.length}] ${m ? `MATCH→Figure ${m[1]}` : 'no-match'}: ${(item || '').slice(0, 120)}`);
  }
  console.log('');
}
await prisma.$disconnect();
