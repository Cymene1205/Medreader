import { db } from "../src/lib/db";
async function main() {
  const papers = await db.paper.findMany({
    select: { id: true, title: true, filePath: true, parseStatus: true, analysisJson: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  for (const p of papers) {
    console.log(`${p.id}  ${p.parseStatus}  ${(p.title || '').slice(0, 50)}  hasAnalysis=${!!p.analysisJson}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
