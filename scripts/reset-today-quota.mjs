// Reset today's mineru_parse quota counters to 0 for ALL users (admin command).
//
// Rationale: the quota system blocked a user mid-day because the cap was hit
// (10/day). After we added the admin bypass, we also want to clear today's
// counts so the affected user can continue immediately rather than wait
// until midnight UTC+8.
//
// Run with: node scripts/reset-today-quota.mjs
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

function todayStrShanghai() {
  const now = new Date();
  const sh = new Date(now.getTime() + 8 * 3600 * 1000);
  return sh.toISOString().slice(0, 10);
}

async function main() {
  const today = todayStrShanghai();
  console.log("Resetting mineru_parse counters for day =", today);

  const before = await db.dailyQuota.findMany({
    where: { action: "mineru_parse", day: today },
  });
  console.log("Before:");
  for (const r of before) {
    console.log(`  - userId=${r.userId} count=${r.count}`);
  }

  // Delete the rows entirely — the next checkAndIncrement call will recreate
  // them with count=1, which is cleaner than leaving 0-count rows around.
  const deleted = await db.dailyQuota.deleteMany({
    where: { action: "mineru_parse", day: today },
  });
  console.log(`\nDeleted ${deleted.count} rows.`);

  // Show the same view after reset.
  const after = await db.dailyQuota.findMany({
    where: { action: "mineru_parse", day: today },
  });
  console.log("After:");
  if (after.length === 0) {
    console.log("  (no rows — quota is fully reset for today)");
  } else {
    for (const r of after) {
      console.log(`  - userId=${r.userId} count=${r.count}`);
    }
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
