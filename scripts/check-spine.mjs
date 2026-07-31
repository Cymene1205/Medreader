import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const p = await prisma.paper.findUnique({
  where: { id: 'cms8lz4cl0002q8lhzxtqz2jf' },
  select: { analysisJson: true, _count: { select: { figures: true } } },
});
console.log('figures count:', p._count.figures);
const a = JSON.parse(p.analysisJson || '{}');
console.log('\n=== analysisJson top keys ===');
console.log(Object.keys(a));
console.log('\n=== argumentSpine ===');
console.log(JSON.stringify(a.argumentSpine, null, 2));
console.log('\n=== failedParts ===');
console.log(a.failedParts);
console.log('\n=== questionBackground (first 400 chars) ===');
console.log((a.questionBackground ? JSON.stringify(a.questionBackground) : 'null').slice(0, 400));
console.log('\n=== novelty (first 400 chars) ===');
console.log((a.novelty ? JSON.stringify(a.novelty) : 'null').slice(0, 400));
await prisma.$disconnect();
