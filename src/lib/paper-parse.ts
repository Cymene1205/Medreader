import { db } from "@/lib/db";
import { parseWithMinerU, markdownToPlainText } from "@/lib/mineru";

const state = globalThis as typeof globalThis & { medreaderJobs?: Map<string, Promise<void>> };
const jobs = state.medreaderJobs ??= new Map<string, Promise<void>>();
export function ensurePaperParsing(paperId: string, filePath: string, batchId?: string): Promise<void> {
  const existing = jobs.get(paperId);
  if (existing) return existing;
  const job = parsePdfBackground(paperId, filePath, batchId).finally(() => jobs.delete(paperId));
  jobs.set(paperId, job);
  return job;
}

async function parsePdfBackground(paperId: string, filePath: string, batchId?: string): Promise<void> {
  try {
    const localMode = process.env.PDF_PARSE_MODE === "local";
    if (localMode) await db.paper.update({where:{id:paperId},data:{parseMessage:"正在本地提取文字和图表页面"}});
    const result = localMode
      ? await (await import("@/lib/pdf-local")).parseLocalPdf(filePath)
      : await parseWithMinerU(filePath, {
      batchId,
      onProgress: async (parseMessage, mineruTaskId) => {
        await db.paper.update({ where: { id: paperId }, data: { parseMessage, ...(mineruTaskId ? { mineruTaskId } : {}) } });
      },
    });
    // Persist the full result before dependent figure/citation extraction.
    // Keep pending until dependent work is finished.
    console.log(`[upload] paper=${paperId} stage=save-result`);
    await db.paper.update({
      where: { id: paperId },
      data: {
        markdown: result.markdown,
        blocksJson: JSON.stringify(result.blocks),
        imagesDir: result.imagesDir,
        pageCount: result.pageCount,
        parsedText: markdownToPlainText(result.markdown),
      },
    });

    // Extract figures + citations BEFORE marking the paper as "done".
    //
    // Why order matters:
    //   The frontend polls /api/paper/[id] and, on parseStatus="done",
    //   immediately fetches /api/figures. If we set "done" first and then
    //   run extractAndStoreFigures, the frontend sees "done" + empty
    //   figures array and marks figuresStatus="idle" — never retrying.
    //   Result: figures never appear until the user manually refreshes.
    //
    // By extracting first and only then flipping parseStatus to "done",
    // the frontend's first figures fetch will see the full list.
    // Extraction is pure-code (no LLM), takes <2s for a typical paper.
    let figCount = 0;
    try {
      const { extractAndStoreFigures } = await import("@/lib/extract-figures");
      figCount = await extractAndStoreFigures(paperId, localMode ? result.blocks.filter(b=>b.type === "image") : result.blocks, result.imagesDir);
      console.log(`[upload] extracted ${figCount} figures for paper ${paperId}`);
    } catch (e) {
      console.warn(`[upload] extractAndStoreFigures failed (non-fatal) for ${paperId}:`, e);
    }
    try {
      const { buildCitationsAndStore } = await import("@/lib/align-citations");
      const cites = await buildCitationsAndStore(paperId);
      console.log(`[upload] stored ${cites.length} citations for paper ${paperId}`);
    } catch (e) {
      console.warn(`[upload] buildCitationsAndStore failed (non-fatal) for ${paperId}:`, e);
    }

    // Now flip parseStatus to "done" — frontend will see done + figures
    // already populated.
    await db.paper.update({
      where: { id: paperId },
      data: {
        parseStatus: "done",
        parseMessage: localMode ? "本地快速解析完成；图片为图表所在原文页面" : "解析结果已保存",
        markdown: result.markdown,
        blocksJson: JSON.stringify(result.blocks),
        imagesDir: result.imagesDir,
        pageCount: result.pageCount,
        // Also store a plain-text version (for chat context redundancy)
        parsedText: markdownToPlainText(result.markdown),
      },
    });
  } catch (e) {
    console.error(`[upload] MinerU parse failed for ${paperId}:`, e);
    // Fallback: try pdfjs-dist
    try {
      const { parseLocalPdf } = await import("@/lib/pdf-local");
      const result = await parseLocalPdf(filePath);
      await db.paper.update({where:{id:paperId},data:{
        parsedText: markdownToPlainText(result.markdown), markdown:result.markdown,
        blocksJson:JSON.stringify(result.blocks),imagesDir:result.imagesDir,pageCount:result.pageCount,
        parseMessage:"MinerU 尚未返回；已使用本地解析，图片为图表所在原文页面",
      }});
      const {extractAndStoreFigures}=await import("@/lib/extract-figures");
      // Local figures have explicit captions; body references are not captions.
      await extractAndStoreFigures(paperId,result.blocks.filter(b=>b.type==='image'),result.imagesDir);
      // Build citations after local text and figure records are available.
      try {
        const { buildCitationsAndStore } = await import("@/lib/align-citations");
        const cites = await buildCitationsAndStore(paperId);
        console.log(`[upload] (fallback) stored ${cites.length} citations for paper ${paperId}`);
      } catch (e2) {
        console.warn(`[upload] (fallback) buildCitationsAndStore failed for ${paperId}:`, e2);
      }
      await db.paper.update({where:{id:paperId},data:{parseStatus:"done"}});
    } catch (e2) {
      console.error(`[upload] pdfjs fallback also failed for ${paperId}:`, e2);
      try {
        await db.paper.update({
          where: { id: paperId },
          data: { parseStatus: "error", parseMessage: "云端解析和本地文字提取均失败" },
        });
      } catch {
        // ignore DB errors during error-state update
      }
    }
  }
}
