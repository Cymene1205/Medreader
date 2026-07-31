import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveLLMConfig, callLLM, parseJsonLoose } from "@/lib/llm";
import { trackEvent } from "@/lib/track";
import type { Citation } from "@/lib/align-citations";
import { groupCitationsByFigure } from "@/lib/align-citations";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/figures
 * Body: { paperId: string }
 *
 * Call A — batch LLM analysis of every main figure in a paper.
 * One DeepSeek call handles all figures in the paper at once, producing
 * per-figure:
 *   - question     (20-50 char, reader-centric question this figure answers)
 *   - method       (5-10 char main experimental technique)
 *   - role         ("铺垫" | "关键证据" | "验证" | "延伸")
 *   - isLinchpin   (≤2 per paper; if false, paper core conclusion still holds)
 *
 * After Call A completes, we also compute `chainIndex` for each figure based
 * on the document-order of the figure's first non-supp citation. Then we
 * trigger the argumentSpine update (a separate lightweight LLM call) so the
 * analysisJson is updated with the figure-anchored narrative summary.
 *
 * Idempotent: if all figures already have `question` non-null, returns
 * the cached result without making any LLM call.
 *
 * Flow:
 *   1. Load Paper + Figures + citationsJson
 *   2. If all figures have question → return existing state (cached)
 *   3. Group citations by figure label → feed into prompt as "citingSentences"
 *   4. One callLLM with json:true, temperature 0.2, maxTokens 6000
 *      (6-7 figures × ~500 tokens each = need headroom)
 *   5. Parse response, write question/method/role/isLinchpin to each Figure row
 *   6. Compute chainIndex from first-citation order, write back
 *   7. Trigger updateArgumentSpine() (separate function — best-effort,
 *      failure doesn't fail this endpoint)
 *   8. Return updated figures array
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const { paperId } = await req.json();
    if (typeof paperId !== "string" || !paperId) {
      return NextResponse.json(
        { error: "paperId is required" },
        { status: 400 }
      );
    }

    // Resolve user ID (anonymous allowed) for token usage tracking.
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }

    const paper = await db.paper.findUnique({
      where: { id: paperId },
      select: {
        id: true,
        title: true,
        citationsJson: true,
        figures: { orderBy: { order: "asc" } },
      },
    });
    if (!paper) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }
    if (paper.figures.length === 0) {
      // No figures extracted (likely pdfjs fallback mode or a review paper).
      // Return empty array — the frontend will show the "no figures" state.
      return NextResponse.json({ figures: [], cached: true });
    }

    // Idempotent: if ALL figures already have question, return cache.
    const allDone = paper.figures.every((f) => typeof f.question === "string" && f.question.trim());
    if (allDone) {
      return NextResponse.json({ figures: paper.figures, cached: true });
    }

    // Parse citations and group by figure label
    let citations: Citation[] = [];
    try {
      const parsed = paper.citationsJson ? JSON.parse(paper.citationsJson) : [];
      if (Array.isArray(parsed)) citations = parsed as Citation[];
    } catch {
      // ignore — proceed with empty citations
    }
    const mainLabels = new Set(paper.figures.map((f) => f.label));
    const citationsByFigure = groupCitationsByFigure(citations, mainLabels);

    // Build the prompt input
    const figInputs = paper.figures.map((f) => ({
      label: f.label,
      caption: f.caption,
      citingSentences: (citationsByFigure[f.label] || []).slice(0, 5), // cap to keep prompt small
    }));

    const systemPrompt =
      "你是科研论文结构分析助手。根据每张图的图注和它在正文中被引用的句子，" +
      "判断每张主图回答了什么科学问题。\n\n" +
      "要求：\n" +
      "- question 必须是问句，20-50字，面向'读者想知道什么'而非'作者展示了什么'。" +
      "好示例：'SiglecF⁺中性粒细胞是否真实存在于梗死区？它有特殊功能吗？' " +
      "坏示例：'该图展示了流式细胞术结果'。\n" +
      "- 依据优先级：正文引用句 > 图注首句，冲突以引用句为准。\n" +
      "- method 填该图最主要实验技术，5-10字，例如 '流式细胞术' 'scRNA-seq' '免疫荧光'。\n" +
      "- role 四选一：铺垫 | 关键证据 | 验证 | 延伸。\n" +
      "  · 铺垫：建立背景或前提（如基线表达、模型建立）\n" +
      "  · 关键证据：直接支撑核心结论\n" +
      "  · 验证：用另一种方法印证已有发现\n" +
      "  · 延伸：拓展到新条件/新模型/新表型\n" +
      "- isLinchpin：该图数据不成立则全文核心结论垮掉则为 true。全文最多 2 张，拿不准一律 false。\n\n" +
      "只输出 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
      '{"figures":[{"label":"Figure 1","question":"…","method":"…","role":"关键证据","isLinchpin":false}]}';

    const userPrompt =
      `论文标题：${paper.title}\n\n` +
      `以下是论文中所有主图的图注及正文引用句。请逐图分析：\n\n` +
      JSON.stringify(figInputs, null, 2);

    let analysisResults: Array<{
      label: string;
      question: string;
      method: string;
      role: string;
      isLinchpin: boolean;
    }> = [];

    try {
      const raw = await callLLM(
        cfg,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        {
          json: true,
          temperature: 0.2,
          maxTokens: 6000,
          usage: {
            userId,
            action: "figures_call_a",
            paperId,
          },
        }
      );
      const parsed = parseJsonLoose(raw) as any;
      analysisResults = Array.isArray(parsed?.figures) ? parsed.figures : [];
    } catch (e) {
      console.warn("[figures] Call A LLM failed:", e);
      // Continue — we'll write empty question/method/role fields so the
      // frontend can show the "generation failed · retry" state.
    }

    // Index by label for quick lookup
    const byLabel: Record<string, (typeof analysisResults)[number]> = {};
    for (const r of analysisResults) {
      if (r && typeof r.label === "string") byLabel[r.label] = r;
    }

    // Compute chainIndex: order of first non-supp citation per figure.
    // Figures with no citations get chainIndex=null.
    const firstCiteOrder: Record<string, number> = {};
    let citeOrder = 0;
    for (const c of citations) {
      if (c.isSupp) continue;
      if (firstCiteOrder[c.figureLabel] === undefined) {
        firstCiteOrder[c.figureLabel] = ++citeOrder;
      }
    }

    // Write back to DB. We do this in a transaction so a partial-write
    // doesn't leave the paper in an inconsistent state.
    await db.$transaction(
      paper.figures.map((f) => {
        const r = byLabel[f.label];
        const chainIndex = firstCiteOrder[f.label] ?? null;
        return db.figure.update({
          where: { id: f.id },
          data: {
            question: r?.question || null,
            method: r?.method || null,
            role: r?.role || null,
            isLinchpin: r?.isLinchpin === true,
            chainIndex,
          },
        });
      })
    );

    // Best-effort: update argumentSpine (lightweight LLM call).
    // Failure here doesn't fail this endpoint — the spine just stays at
    // its previous value (or null on first run).
    try {
      const { updateArgumentSpine } = await import("@/lib/analyze-stage2");
      await updateArgumentSpine(paperId, cfg, userId);
    } catch (e) {
      console.warn("[figures] argumentSpine update failed (non-fatal):", e);
    }

    // Track event (best-effort)
    try {
      await trackEvent(userId, "figures_analyzed", JSON.stringify({ paperId, figureCount: paper.figures.length }));
    } catch {
      // ignore tracking errors
    }

    // Return the updated figures
    const updatedFigures = await db.figure.findMany({
      where: { paperId },
      orderBy: { order: "asc" },
    });
    return NextResponse.json({ figures: updatedFigures, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[figures] POST failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/figures?paperId=...
 * Returns the current Figure rows for a paper (no LLM call).
 * Used by the frontend to poll for Call A results.
 */
export async function GET(req: NextRequest) {
  try {
    const paperId = req.nextUrl.searchParams.get("paperId");
    if (!paperId) {
      return NextResponse.json(
        { error: "paperId query param required" },
        { status: 400 }
      );
    }
    const figures = await db.figure.findMany({
      where: { paperId },
      orderBy: { order: "asc" },
    });
    const cached = figures.length > 0 && figures.every((f) => f.question);
    return NextResponse.json({ figures, cached });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
