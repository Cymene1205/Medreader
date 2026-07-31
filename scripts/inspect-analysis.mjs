import { PrismaClient } from '@prisma/client';
import fs from 'fs';
const db = new PrismaClient();
const papers = await db.paper.findMany({
  where: { analysisJson: { not: null } },
  select: { id: true, title: true, analysisJson: true },
  take: 5,
});
for (const p of papers) {
  console.log('=== Paper:', p.title, '===');
  let a;
  try { a = JSON.parse(p.analysisJson); } catch { console.log('  [unparseable]'); continue; }
  for (const key of ['questionBackground', 'argumentSpine', 'novelty', 'limitsOpportunities']) {
    if (a[key]) {
      console.log(`  [${key}] summary (${a[key].summary?.length||0} chars):`, JSON.stringify(a[key].summary));
      if (a[key].detail) {
        console.log(`  [${key}] detail (${a[key].detail.length} chars):`, JSON.stringify(a[key].detail.slice(0, 300)));
      }
      if (a[key].pairs) {
        for (const pair of a[key].pairs.slice(0, 2)) {
          console.log(`    pair.limitation:`, JSON.stringify(pair.limitation));
          console.log(`    pair.opportunity:`, JSON.stringify(pair.opportunity));
        }
      }
    }
  }
}
await db.$disconnect();
