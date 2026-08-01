import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const figs = await db.figure.findMany({
  select: { id: true, label: true, role: true, question: true, caption: true, isLinchpin: true, method: true, chainIndex: true },
  take: 5,
});
for (const f of figs) {
  console.log('=== Figure:', f.label, '(linchpin:', f.isLinchpin, ') ===');
  console.log('  role:', JSON.stringify(f.role));
  console.log('  method:', JSON.stringify(f.method));
  console.log('  question:', JSON.stringify(f.question));
  console.log('  caption:', JSON.stringify(f.caption?.slice(0, 200)));
}
await db.$disconnect();
