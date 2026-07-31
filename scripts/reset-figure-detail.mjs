// Reset all figures' detailStatus to "none" so the next expand triggers
// Call B with the NEW system prompt (free-naming layer titles, no longer
// the 7-category forced rule).
//
// Usage: node scripts/reset-figure-detail.mjs

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const result = await db.figure.updateMany({
    where: { detailStatus: "done" },
    data: { detailStatus: "none", detailJson: null },
  });
  console.log(`Reset ${result.count} figures from detailStatus=done → none`);

  const total = await db.figure.count();
  console.log(`Total figures in DB: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
