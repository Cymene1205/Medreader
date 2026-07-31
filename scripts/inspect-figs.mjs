import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const figs = await db.figure.findMany({
  select: { id: true, label: true, role: true, question: true, finding: true, isLinchpin: true },
  take: 8,
});
for (const f of figs) {
  console.log('=== Figure:', f.label, '(linchpin:', f.isLinchpin, ') ===');
  console.log('  role:', JSON.stringify(f.role));
  console.log('  question:', JSON.stringify(f.question));
  console.log('  finding:', JSON.stringify(f.finding?.slice(0, 200)));
}
await db.$disconnect();
