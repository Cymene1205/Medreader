import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const p = await prisma.paper.findFirst({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { blocksJson: true },
});
const blocks = JSON.parse(p.blocksJson || '[]');
for (const i of [71, 126, 145, 199, 238]) {
  const b = blocks[i];
  console.log(`\n=== [idx=${i}] type=${b.type} page=${b.page_idx} ===`);
  console.log('  chart_caption type:', typeof b.chart_caption, 'isArray:', Array.isArray(b.chart_caption));
  console.log('  chart_caption value:', JSON.stringify(b.chart_caption)?.slice(0, 400));
  console.log('  image_caption type:', typeof b.image_caption, 'isArray:', Array.isArray(b.image_caption));
  console.log('  image_caption value:', JSON.stringify(b.image_caption)?.slice(0, 400));
}
await prisma.$disconnect();
