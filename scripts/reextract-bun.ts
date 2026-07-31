/**
 * Re-extract figures for an existing paper using the NEW extract-figures.ts
 * logic (which properly merges split panels + picks largest bbox).
 *
 * Usage:
 *   bun run scripts/reextract-bun.ts <paperId>
 *
 * If no paperId given, lists all papers with their current figure counts.
 */
import { PrismaClient } from "@prisma/client";
import { extractAndStoreFigures } from "../src/lib/extract-figures";

const prisma = new PrismaClient();

async function main() {
  const paperId = process.argv[2];

  if (!paperId) {
    const papers = await prisma.paper.findMany({
      select: {
        id: true,
        title: true,
        createdAt: true,
        _count: { select: { figures: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    console.log("Recent papers (pass paperId as arg to re-extract):");
    for (const p of papers) {
      console.log(
        `  ${p.id}  figs=${p._count.figures}  ${(p.title || "").slice(0, 70)}`
      );
    }
    return;
  }

  console.log(`Re-extracting figures for paper ${paperId}...`);
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { id: true, title: true, imagesDir: true },
  });
  if (!paper) {
    console.error(`Paper ${paperId} not found`);
    process.exit(1);
  }
  console.log(`  title: ${paper.title}`);
  console.log(`  imagesDir: ${paper.imagesDir || "(none)"}`);

  // extractAndStoreFigures is idempotent — deletes old rows then inserts.
  const count = await extractAndStoreFigures(paperId);
  console.log(`✓ extracted ${count} figures`);

  // Show what we got
  const figs = await prisma.figure.findMany({
    where: { paperId },
    orderBy: { order: "asc" },
    select: {
      label: true,
      pageIndex: true,
      imagePath: true,
      caption: true,
      question: true,
    },
  });
  for (const f of figs) {
    console.log(
      `  ${f.label}  p.${f.pageIndex}  img=${f.imagePath ? "✓" : "✗"}  q=${f.question ? "✓" : "✗"}  cap.len=${f.caption.length}`
    );
  }

  // Clear stale argumentSpine + figure detailStatus so they re-run
  const existing = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { analysisJson: true },
  });
  if (existing?.analysisJson) {
    try {
      const a = JSON.parse(existing.analysisJson);
      let changed = false;
      if (a.argumentSpine) {
        a.argumentSpine = null;
        a.failedParts = (a.failedParts || []).filter(
          (p: string) => p !== "argumentSpine"
        );
        changed = true;
        console.log("  cleared stale argumentSpine");
      }
      if (changed) {
        await prisma.paper.update({
          where: { id: paperId },
          data: { analysisJson: JSON.stringify(a) },
        });
      }
    } catch {
      /* ignore */
    }
  }

  // Reset figure detailStatus so the new "table/机制/临床" layer titles regenerate
  await prisma.figure.updateMany({
    where: { paperId, detailStatus: "done" },
    data: { detailStatus: "none", detailJson: null },
  });
  console.log("  reset figure detailStatus (will regenerate on next expand)");

  console.log(
    "\nNext step: in the browser, refresh the paper page — figures will auto-trigger Call A."
  );
  console.log(
    "Or POST /api/figures with { paperId } to trigger Call A + spine server-side."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
