import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Production: only warn/error (default).
// Development: also log queries — useful for debugging but very noisy,
// so we never enable it in prod (fix #3 — stops `prisma:query SELECT …`
// from flooding the container logs and hiding real errors).
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
