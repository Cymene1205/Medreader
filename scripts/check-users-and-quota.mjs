// Quick DB inspector: list users and today's mineru_parse quota usage.
// Run with: node scripts/check-users-and-quota.mjs
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function todayStrShanghai() {
  const now = new Date();
  const sh = new Date(now.getTime() + 8 * 3600 * 1000);
  return sh.toISOString().slice(0, 10);
}

async function main() {
  const today = todayStrShanghai();
  console.log("=== Today (UTC+8):", today, "===");

  console.log("\n--- Users ---");
  const users = await db.user.findMany({
    select: { id: true, email: true, name: true, role: true, createdAt: true, passwordHash: true },
    orderBy: { createdAt: "asc" },
  });
  for (const u of users) {
    console.log(
      `  - ${u.email.padEnd(34)} role=${u.role.padEnd(6)} name=${u.name ?? "(none)"} pwd_prefix=${u.passwordHash.slice(0, 12)}... created=${u.createdAt.toISOString()}`
    );
  }
  if (users.length === 0) {
    console.log("  (no users in DB)");
  }

  console.log("\n--- Today's mineru_parse quota usage ---");
  const rows = await db.dailyQuota.findMany({
    where: { action: "mineru_parse", day: today },
    orderBy: { count: "desc" },
  });
  for (const r of rows) {
    console.log(`  - userId=${(r.userId || "(null)").padEnd(40)} count=${r.count} meta=${r.meta ?? "(none)"}`);
  }
  if (rows.length === 0) {
    console.log("  (no mineru_parse usage recorded today)");
  }

  console.log("\n--- Recent 5 mineru_parse quota entries (any day) ---");
  const recent = await db.dailyQuota.findMany({
    where: { action: "mineru_parse" },
    orderBy: { day: "desc" },
    take: 5,
  });
  for (const r of recent) {
    console.log(`  - day=${r.day} userId=${(r.userId || "(null)").padEnd(40)} count=${r.count}`);
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
