const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const figs = await p.figure.findMany({
    select: { label: true, caption: true, detailStatus: true },
    take: 5,
    orderBy: { createdAt: 'desc' }
  });
  for (const f of figs) {
    console.log('===', f.label, '(status:', f.detailStatus + ') ===');
    console.log('caption length:', f.caption?.length || 0);
    console.log('caption preview:', (f.caption || '').slice(0, 500));
    console.log();
  }
  await p.$disconnect();
})();
