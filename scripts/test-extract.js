// Test the new caption-anchored figure extraction against existing papers.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Replicate the new MAIN_FIGURE_RE and extractFiguresFromBlocks logic.
const MAIN_FIGURE_RE = /^\s*(?!.*(?:Supplementary|Extended\s+Data|\bS\d))(?:Fig(?:ure|\.)?)\s*(\d+)/i;

function countPanels(caption) {
  if (!caption) return 0;
  const paren = caption.match(/\(\s*([a-z])\s*\)/gi);
  if (paren && paren.length >= 2) {
    const letters = paren
      .map((p) => p.replace(/[()]/g, "").trim().toLowerCase())
      .filter((c) => /^[a-z]$/.test(c));
    if (letters.length > 0) {
      return letters.reduce((m, c) => Math.max(m, c.charCodeAt(0) - 96), 0);
    }
  }
  const range = caption.match(/\(\s*([A-Z])\s*[–\-—]\s*([A-Z])\s*\)/);
  if (range) {
    const start = range[1].charCodeAt(0) - 64;
    const end = range[2].charCodeAt(0) - 64;
    if (start > 0 && end >= start) return end;
  }
  return 0;
}

function extractFiguresFromBlocks(blocks, imagesDir) {
  const out = [];
  let order = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "text") continue;
    const rawCap = (typeof b.text === "string" ? b.text : "").trim();
    if (!rawCap) continue;
    const m = rawCap.match(MAIN_FIGURE_RE);
    if (!m) continue;
    const num = m[1];
    if (!num) continue;
    const label = `Figure ${num}`;
    if (rawCap.length < 30) continue;
    if (/https?:\/\//i.test(rawCap)) continue;
    const existing = out.find((f) => f.label === label);
    if (existing) {
      if (rawCap.length > existing.caption.length) {
        existing.caption = rawCap;
      }
      continue;
    }
    let imgBlock = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const nb = blocks[j];
      if (nb.type === "image" || nb.type === "chart") {
        imgBlock = nb;
        break;
      }
      if (nb.type === "text") {
        const prevText = (nb.text || "").trim();
        if (/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(prevText)) break;
        if (typeof nb.text_level === "number" && nb.text_level === 1) break;
      }
    }
    if (!imgBlock) {
      for (let j = i + 1; j <= Math.min(blocks.length - 1, i + 2); j++) {
        const nb = blocks[j];
        if (nb.type === "image" || nb.type === "chart") {
          imgBlock = nb;
          break;
        }
      }
    }
    let imagePath = null;
    if (imgBlock && imgBlock.img_path && imagesDir) {
      const cleanName = imgBlock.img_path
        .replace(/^images\//, "")
        .replace(/^\//, "");
      const basename = cleanName.split("/").pop();
      if (basename) imagePath = `${imagesDir.replace(/\/$/, "")}/${basename}`;
    }
    out.push({
      label,
      caption: rawCap,
      imagePath,
      pageIndex: (b.page_idx ?? 0) + 1,
      order: order++,
      panelCount: countPanels(rawCap),
      foundImage: !!imgBlock,
    });
  }
  return out;
}

async function main() {
  const papers = await prisma.paper.findMany({
    select: { id: true, title: true, blocksJson: true, imagesDir: true },
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  for (const p of papers) {
    console.log("\n========================================");
    console.log("Paper:", (p.title || "").slice(0, 60));
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

    const figures = extractFiguresFromBlocks(blocks, p.imagesDir);
    console.log(`  Extracted ${figures.length} figures:`);
    for (const f of figures) {
      console.log(
        `    ${f.label} | page ${f.pageIndex} | panels=${f.panelCount} | image=${f.foundImage ? "✓" : "✗"}`
      );
      console.log(`      caption: ${f.caption.slice(0, 120)}${f.caption.length > 120 ? "…" : ""}`);
      if (f.imagePath) {
        console.log(`      image: ${f.imagePath.split("/").pop()}`);
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
