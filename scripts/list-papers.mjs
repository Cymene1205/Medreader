import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const papers = await prisma.paper.findMany({
  where: { title: { contains: 'vafadarnejad' } },
  orderBy: { createdAt: 'desc' },
  select: { id: true, title: true, createdAt: true, _count: { select: { figures: true } } },
});
for (const p of papers) console.log(p.id, p.createdAt, 'figs:', p._count.figures, p.title.slice(0, 50));
await prisma.$disconnect();
