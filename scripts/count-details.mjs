import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const c = await db.figure.count({ where: { detailJson: { not: null } } });
console.log('figures with detailJson:', c);
const c2 = await db.figure.count();
console.log('total figures:', c2);
await db.$disconnect();
