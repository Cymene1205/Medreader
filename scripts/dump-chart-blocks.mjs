import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const p = await prisma.paper.findFirst({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { blocksJson: true },
});
const blocks = JSON.parse(p.blocksJson || '[]');

// Show first 10 chart/image blocks with ALL their fields
console.log('=== First 12 chart/image blocks (full structure) ===');
let shown = 0;
for (let i = 0; i < blocks.length && shown < 12; i++) {
  const b = blocks[i];
  if (b.type !== 'chart' && b.type !== 'image') continue;
  console.log(`\n[idx=${i}] type=${b.type} page=${b.page_idx}`);
  console.log(JSON.stringify(b, null, 2));
  // Show surrounding context — 1 block before, 1 after
  if (i > 0) console.log('  PREV:', JSON.stringify({ type: blocks[i-1].type, text: (blocks[i-1].text || blocks[i-1].chart_caption || '').slice(0, 100) }));
  if (i < blocks.length - 1) console.log('  NEXT:', JSON.stringify({ type: blocks[i+1].type, text: (blocks[i+1].text || blocks[i+1].chart_caption || '').slice(0, 100) }));
  shown++;
}

// Also scan for any block whose chart_caption / table_caption contains "Figure"
console.log('\n\n=== Blocks whose chart_caption mentions "Figure" ===');
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  const cap = b.chart_caption || b.table_caption || '';
  if (/fig/i.test(cap)) {
    console.log(`[idx=${i}] type=${b.type} cap: ${cap.slice(0, 200)}`);
  }
}

// And look for ANY text containing "Figure 2", "Figure 4", "Figure 5" (anywhere in text, not just at start)
console.log('\n\n=== Any block whose text contains "Figure 2" / "Figure 4" / "Figure 5" ===');
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  const t = b.text || b.chart_caption || b.table_caption || '';
  if (/Figure\s*[245](?!\d)/i.test(t)) {
    console.log(`[idx=${i}] type=${b.type} lvl=${b.text_level}`);
    console.log(`  text: ${t.slice(0, 300)}`);
  }
}
await prisma.$disconnect();
