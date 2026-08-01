// Deeper inspection: find ALL "Figure N" mentions in text blocks
// (not just caption-anchored), to understand the full caption landscape.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const paper = await prisma.paper.findFirst({
    where: { id: "cms7tdlem0002qt4zhwn07a5t" },
    select: { blocksJson: true },
  });
  if (!paper || !paper.blocksJson) return;
  const blocks = JSON.parse(paper.blocksJson);

  console.log("=== ALL text blocks containing 'Figure' ===");
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "text") continue;
    const text = (b.text || "").trim();
    if (!/fig/i.test(text)) continue;
    const startsWithFig = /^\s*fig/i.test(text);
    console.log(
      `[${i}] page=${b.page_idx} lvl=${b.text_level || "-"} ${startsWithFig ? "★STARTS" : "       "} ${text.slice(0, 140)}`
    );
  }

  console.log("\n=== ALL image/chart blocks (with surrounding text) ===");
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "image" && b.type !== "chart") continue;
    // Find nearest following text block
    let nextText = "";
    for (let j = i + 1; j < Math.min(blocks.length, i + 4); j++) {
      if (blocks[j].type === "text" && (blocks[j].text || "").trim()) {
        nextText = (blocks[j].text || "").trim().slice(0, 100);
        break;
      }
    }
    console.log(
      `[${i}] ${b.type} page=${b.page_idx} img=${(b.img_path || "").split("/").pop()} → next: ${nextText}`
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
