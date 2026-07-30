// Test MinerU API end-to-end with the actual PDF
import { parseWithMinerU } from "../src/lib/mineru";

(async () => {
  try {
    console.log("Submitting PDF to MinerU...");
    const t0 = Date.now();
    const result = await parseWithMinerU("/home/z/my-project/download/sample-paper.pdf");
    console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log("markdown length:", result.markdown.length);
    console.log("blocks count:", result.blocks.length);
    console.log("imagesDir:", result.imagesDir);
    console.log("pageCount:", result.pageCount);
    console.log("---first 400 chars of markdown:");
    console.log(result.markdown.slice(0, 400));
    console.log("---first 5 blocks:");
    for (const b of result.blocks.slice(0, 5)) {
      console.log(JSON.stringify({ type: b.type, text_level: b.text_level, page_idx: b.page_idx, text: (b.text||"").slice(0, 100) }));
    }
    console.log("---blocks by type:");
    const byType: Record<string, number> = {};
    for (const b of result.blocks) byType[b.type] = (byType[b.type] || 0) + 1;
    console.log(byType);
  } catch (e: any) {
    console.error("FAIL:", e.message);
    console.error(e.stack);
  }
})();
