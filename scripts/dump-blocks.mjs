import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
// Use vafadarnejad paper (only 1 figure extracted, but should have 6)
const p = await prisma.paper.findFirst({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { id: true, blocksJson: true, imagesDir: true },
});
if (!p) { console.log('not found'); process.exit(1); }
console.log('paper id:', p.id);
console.log('imagesDir:', p.imagesDir);
const blocks = JSON.parse(p.blocksJson || '[]');
console.log('total blocks:', blocks.length);

// Find all text blocks that contain "Figure" or "Fig"
console.log('\n=== text blocks mentioning Figure N ===');
let count = 0;
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (b.type !== 'text') continue;
  const t = (b.text || '').trim();
  if (/^(?:Fig(?:ure|\.)?)\s*\d+/i.test(t)) {
    count++;
    console.log(`[idx=${i} page=${b.page_idx} lvl=${b.text_level}] len=${t.length}`);
    console.log(`  text: ${t.slice(0, 200)}`);
    if (count >= 20) break;
  }
}
console.log('total Figure-starting text blocks:', count);

// Also check what block types exist
const types = {};
for (const b of blocks) types[b.type] = (types[b.type] || 0) + 1;
console.log('\nblock type counts:', types);
await prisma.$disconnect();
