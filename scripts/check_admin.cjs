const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const admins = await p.user.findMany({ where: { role: 'admin' }, select: { email: true, name: true } });
  console.log('admins:', JSON.stringify(admins, null, 2));
  const total = await p.user.count();
  console.log('total users:', total);
  await p.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
