// Inspect a paper's blocks JSON to verify our figure extraction hypothesis:
// MinerU vlm mode puts figure captions as separate text blocks, not as
// chart_caption fields on image blocks.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const papers = await prisma.paper.findMany({
    select: { id: true, title: true, blocksJson: true, imagesDir: true, figures: true },
    take: 3,
    orderBy: { createdAt: "desc" },
  });

  for (const p of papers) {
    console.log("\n========================================");
    console.log("Paper:", p.id, "·", (p.title || "").slice(0, 60));
    console.log("imagesDir:", p.imagesDir);
    console.log("Existing Figure rows:", p.figures.length);
    if (!p.blocksJson) {
      console.log("  (no blocksJson)");
      continue;
    }
    let blocks;
    try {
      blocks = JSON.parse(p.blocksJson);
    } catch {
      console.log("  (blocksJson parse failed)");
      continue;
    }
    console.log("  blocks count:", blocks.length);

    // Count by type
    const byType = {};
    for (const b of blocks) {
      byType[b.type] = (byType[b.type] || 0) + 1;
    }
    console.log("  by type:", byType);

    // Find all image/chart blocks and inspect them
    console.log("\n  --- image/chart blocks (first 5) ---");
    let imgCount = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type !== "image" && b.type !== "chart") continue;
      imgCount++;
      if (imgCount > 5) break;
      console.log(`  [${i}] type=${b.type} page_idx=${b.page_idx}`);
      console.log(`      img_path=${b.img_path || "(none)"}`);
      console.log(`      chart_caption=${b.chart_caption ? b.chart_caption.slice(0, 80) : "(none)"}`);
      console.log(`      text=${b.text ? b.text.slice(0, 80) : "(none)"}`);
      // Show surrounding blocks
      for (let j = Math.max(0, i - 1); j <= Math.min(blocks.length - 1, i + 2); j++) {
        if (j === i) continue;
        const nb = blocks[j];
        const t = (nb.text || nb.chart_caption || "").slice(0, 80);
        console.log(`      neighbor[${j}] type=${nb.type} text_level=${nb.text_level || "-"}: ${t}`);
      }
    }
    console.log("  total image/chart blocks:", imgCount);

    // Find all text blocks that start with "Figure N" — these are the captions
    console.log("\n  --- caption-like text blocks (first 8) ---");
    let capCount = 0;
    const capRe = /^(?!.*(?:Supplementary|Extended\s+Data|\bS\d))\s*(?:Fig(?:ure|\.)?)\s*(\d+)/i;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type !== "text") continue;
      const text = (b.text || "").trim();
      if (!capRe.test(text)) continue;
      capCount++;
      if (capCount > 8) continue;
      console.log(`  [${i}] page_idx=${b.page_idx} text_level=${b.text_level || "-"}`);
      console.log(`      text: ${text.slice(0, 120)}`);
      // Look back 1-3 blocks for image
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const nb = blocks[j];
        if (nb.type === "image" || nb.type === "chart") {
          console.log(`      ← found image block at [${j}] img_path=${nb.img_path}`);
          break;
        }
      }
    }
    console.log("  total caption-like text blocks:", capCount);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
