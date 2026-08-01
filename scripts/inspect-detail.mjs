import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const figs = await db.figure.findMany({
  where: { detailJson: { not: null } },
  select: { id: true, label: true, detailJson: true },
  take: 3,
});
for (const f of figs) {
  console.log('=== Figure:', f.label, '===');
  let d;
  try { d = JSON.parse(f.detailJson); } catch { console.log('  [unparseable]'); continue; }
  console.log('  closure:', JSON.stringify(d.closure?.slice(0, 200)));
  console.log('  bridge:', JSON.stringify(d.bridge?.slice(0, 200)));
  if (d.layers) {
    for (const l of d.layers.slice(0, 2)) {
      console.log('  layer.title:', JSON.stringify(l.title));
      console.log('  layer.conclusion:', JSON.stringify(l.conclusion?.slice(0, 150)));
      console.log('  layer.purpose:', JSON.stringify(l.purpose?.slice(0, 150)));
      if (l.panelDetails) {
        for (const pd of l.panelDetails.slice(0, 2)) {
          console.log('    pd.text:', JSON.stringify(pd.text?.slice(0, 200)));
          console.log('    pd.relation:', JSON.stringify(pd.relation));
        }
      }
    }
  }
}
await db.$disconnect();
