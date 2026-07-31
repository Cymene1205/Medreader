import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const papers = await prisma.paper.findMany({
  select: { id: true, title: true, parseStatus: true, imagesDir: true, _count: { select: { figures: true } } },
  orderBy: { createdAt: 'desc' },
  take: 8,
});
console.log('=== Papers ===');
for (const p of papers) {
  const paper = await prisma.paper.findUnique({ where: { id: p.id }, select: { blocksJson: true } });
  console.log({
    id: p.id.slice(-6),
    title: (p.title || '').slice(0, 60),
    parseStatus: p.parseStatus,
    figures: p._count.figures,
    imagesDir: p.imagesDir,
    blocksLen: paper?.blocksJson?.length ?? 0,
  });
}
console.log('\n=== First 10 figures across all papers ===');
const figs = await prisma.figure.findMany({
  take: 10,
  select: { paperId: true, label: true, caption: true, imagePath: true, pageIndex: true, order: true, question: true, role: true },
  orderBy: { order: 'asc' },
});
for (const f of figs) console.log({
  pid: f.paperId.slice(-6),
  label: f.label,
  hasImage: !!f.imagePath,
  hasQ: !!f.question,
  hasRole: !!f.role,
  page: f.pageIndex,
  caption: (f.caption || '').slice(0, 60),
});
await prisma.$disconnect();
