import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const papers = await prisma.paper.findMany({
  select: { id: true, title: true, parseStatus: true, analysisJson: true, _count: { select: { figures: true } } },
  orderBy: { createdAt: 'desc' },
  take: 6,
});
console.log('=== Papers ===');
for (const p of papers) {
  console.log({
    id: p.id.slice(-6),
    title: (p.title || '').slice(0, 70),
    parseStatus: p.parseStatus,
    figures: p._count.figures,
    hasAnalysis: !!p.analysisJson,
    analysisLen: p.analysisJson?.length ?? 0,
  });
}
console.log('\n=== Full figure list of one paper ===');
const firstPaper = papers[0];
if (firstPaper) {
  const figs = await prisma.figure.findMany({
    where: { paperId: firstPaper.id },
    select: { label: true, caption: true, imagePath: true, question: true, role: true, isLinchpin: true, chainIndex: true },
    orderBy: { order: 'asc' },
  });
  for (const f of figs) {
    console.log({
      label: f.label,
      hasImage: !!f.imagePath,
      hasQ: !!f.question,
      hasRole: !!f.role,
      isLinchpin: f.isLinchpin,
      chainIndex: f.chainIndex,
      captionFull: f.caption,
    });
  }
  console.log('\n=== analysisJson of this paper ===');
  if (firstPaper.analysisJson) {
    const a = JSON.parse(firstPaper.analysisJson);
    console.log('top keys:', Object.keys(a));
    if (a.argumentSpine) {
      console.log('argumentSpine keys:', Object.keys(a.argumentSpine));
      if (Array.isArray(a.argumentSpine.steps)) {
        console.log('steps count:', a.argumentSpine.steps.length);
        console.log('first 2 steps:', JSON.stringify(a.argumentSpine.steps.slice(0, 2), null, 2));
      } else {
        console.log('argumentSpine content (truncated):', JSON.stringify(a.argumentSpine).slice(0, 600));
      }
    }
  }
}
await prisma.$disconnect();
