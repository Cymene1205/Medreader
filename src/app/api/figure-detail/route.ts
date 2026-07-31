import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveLLMConfig, callLLM, parseJsonLoose } from "@/lib/llm";
import { trackEvent } from "@/lib/track";
import type { Citation } from "@/lib/align-citations";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/figure-detail
 * Body: { paperId: string, figureLabel: string }
 *
 * Call B — on-demand deep panel-level analysis of a single figure.
 * Triggered by the frontend when the user first expands a Figure card.
 *
 * Input to the LLM:
 *   - The figure's caption (full text)
 *   - All citing sentences for this figure + their containing paragraphs
 *     (each paragraph capped at 1500 chars, total ≤ 12000 chars)
 *   - The PREVIOUS figure's question (for "bridge" generation)
 *
 * Output (stored on Figure.detailJson):
 *   {
 *     question?:  string   // optional refined version of the figure's question
 *     closure:    string   // 15-30 char "X→Y→Z" one-liner
 *     layers:     [{       // 1-4 layers per figure
 *       title:          string,
 *       panels:         string[],
 *       purpose:        string,
 *       panelDetails:   [{ panel, text, relation? }],
 *       conclusion:     string  // →-prefixed
 *     }],
 *     bridge:     string  // how this figure connects to prev/next
 *   }
 *
 * Idempotent: detailStatus="done" returns the cached detailJson.
 * Concurrent-safe: detailStatus="pending" returns 409.
 * Retriable: detailStatus="error" re-runs the analysis.
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const { paperId, figureLabel } = await req.json();
    if (typeof paperId !== "string" || !paperId) {
      return NextResponse.json({ error: "paperId is required" }, { status: 400 });
    }
    if (typeof figureLabel !== "string" || !figureLabel) {
      return NextResponse.json({ error: "figureLabel is required" }, { status: 400 });
    }

    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }

    // Load the figure + the paper context (citations, prev figure)
    const figure = await db.figure.findFirst({
      where: { paperId, label: figureLabel },
    });
    if (!figure) {
      return NextResponse.json(
        { error: `Figure ${figureLabel} not found on paper ${paperId}` },
        { status: 404 }
      );
    }

    // Already done → return cache
    if (figure.detailStatus === "done" && figure.detailJson) {
      return NextResponse.json({
        detail: JSON.parse(figure.detailJson),
        cached: true,
      });
    }

    // Pending → return 409 (another call is in-flight)
    if (figure.detailStatus === "pending") {
      return NextResponse.json(
        { error: "Figure detail generation is in progress" },
        { status: 409 }
      );
    }

    // Mark pending to prevent concurrent calls
    await db.figure.update({
      where: { id: figure.id },
      data: { detailStatus: "pending" },
    });

    try {
      // Build the LLM context: figure caption + citing paragraphs + prev figure's question
      const paper = await db.paper.findUnique({
        where: { id: paperId },
        select: { title: true, markdown: true, parsedText: true, citationsJson: true },
      });
      if (!paper) throw new Error("Paper not found");

      // Parse citations and extract paragraphs containing this figure's references
      let citations: Citation[] = [];
      try {
        const parsed = paper.citationsJson ? JSON.parse(paper.citationsJson) : [];
        if (Array.isArray(parsed)) citations = parsed as Citation[];
      } catch {
        // ignore
      }
      const thisFigCitations = citations.filter(
        (c) => c.figureLabel === figureLabel && !c.isSupp
      );

      // Extract surrounding paragraphs (±1 paragraph) from the markdown.
      // We split markdown on double-newlines into paragraphs, then for each
      // citation sentence, find the paragraph that contains it.
      const sourceText = paper.markdown || paper.parsedText || "";
      const paragraphs = sourceText.split(/\n\s*\n/);
      const citedParagraphs: string[] = [];
      for (const c of thisFigCitations) {
        const sentenceLower = c.sentence.toLowerCase();
        for (let i = 0; i < paragraphs.length; i++) {
          if (paragraphs[i].toLowerCase().includes(sentenceLower.slice(0, 60))) {
            // Add this paragraph + its neighbors (window of ±1)
            const start = Math.max(0, i - 1);
            const end = Math.min(paragraphs.length - 1, i + 1);
            for (let j = start; j <= end; j++) {
              const p = paragraphs[j].trim();
              if (p && !citedParagraphs.includes(p)) {
                citedParagraphs.push(p.slice(0, 1500));
              }
            }
            break;
          }
        }
      }
      // Cap total to 12000 chars
      let totalContext = "";
      for (const p of citedParagraphs) {
        if (totalContext.length + p.length > 12000) break;
        totalContext += p + "\n\n";
      }

      // Find the previous figure's question (by chainIndex, fallback to order)
      const allFigures = await db.figure.findMany({
        where: { paperId },
        orderBy: { order: "asc" },
      });
      let prevQuestion = "";
      const currentIdx = allFigures.findIndex((f) => f.id === figure.id);
      if (currentIdx > 0) {
        prevQuestion = allFigures[currentIdx - 1].question || "";
      }

      const systemPrompt =
        "你是科研论文图表逻辑分析助手。分析指定图版的内部逻辑，输出层级化 JSON。\n\n" +
        "一张图的若干 panel 按论证目的可划分为 1-4 个'层级'，每层级是一组服务于同一小目标的 panel。\n\n" +
        "⚠️ 层级命名规则（重要）：每层的 title 必须从以下科研论证层次中选择一个最贴切的：\n" +
        "  - '引出问题'：通过基线/对照数据揭示临床现象或未解之谜，提出本文要回答的问题\n" +
        "  - '提出猜想'：基于初步观察提出假说或工作假设\n" +
        "  - '表型层'：描述宏观表型/差异/分类（如细胞群分布、组织形态、临床指标对比）\n" +
        "  - '机制层'：揭示分子/cell-cell/通路级别的机制（如基因表达、信号通路、相互作用）\n" +
        "  - '验证猜想'：通过干预（敲除/过表达/药物/抗体）直接验证上述机制猜想\n" +
        "  - '临床数据'：患者队列、临床指标、生存分析等转化证据\n" +
        "  - '方法建立'：建立新技术/模型/资源（仅当这是该层主要目的时使用）\n" +
        "若一层涉及多个目的，按主要目的归类；title 只写上述中文短语之一，不要再加修饰。\n\n" +
        "字段要求：\n" +
        "- closure：一句话概括全图逻辑闭环，常为'从X到Y，从Y到Z'，15-30字。\n" +
        "- layers[]：title（必须是上述7个层次名之一）、panels（panel字母数组）、purpose（这层干什么、与上层关系，30-80字）、" +
        "panelDetails[]（每panel或每组panel一条：panel、text 15-60字、relation 仅在正文有明确依据时标" +
        "'递进|平行|正交验证|对照|补充'，无依据省略）、conclusion（20-50字，'→'开头）。\n" +
        "- bridge：承上启下，此图如何承接上文、为下文哪张图/哪个论点铺路，40-80字。\n\n" +
        "铁律：所有内容必须能从引用句和图注找到依据，禁止编造数值；引用句未覆盖的 panel 只依据图注，" +
        "text 末尾加'（据图注）'。\n\n" +
        "只输出 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
        '{"question":"可选refine版问句","closure":"…","layers":[{"title":"表型层","panels":["A","B"],"purpose":"…","panelDetails":[{"panel":"A","text":"…","relation":"递进"}],"conclusion":"→…"}],"bridge":"…"}';

      const userPrompt =
        `论文标题：${paper.title}\n` +
        `目标图版：${figureLabel}\n` +
        `图注：\n${figure.caption}\n\n` +
        `正文引用段落（最多12000字符）：\n"""\n${totalContext || "（无引用句覆盖，请仅依据图注分析）"}\n"""\n\n` +
        (prevQuestion ? `上一张图(${allFigures[currentIdx - 1].label})的问句：${prevQuestion}\n\n` : "") +
        `请生成 ${figureLabel} 的层级化逻辑分析。`;

      const raw = await callLLM(
        cfg,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        {
          json: true,
          temperature: 0.3,
          maxTokens: 6000,
          usage: {
            userId,
            action: "figure_detail_call_b",
            paperId,
          },
        }
      );

      const parsed = parseJsonLoose(raw) as any;

      // Validate the minimal required structure
      if (!parsed || typeof parsed !== "object" || !parsed.closure || !Array.isArray(parsed.layers)) {
        throw new Error("LLM output missing required fields (closure/layers)");
      }

      // If LLM returned a refined question, sync it back to the Figure row
      // (this updates the card display too).
      const refinedQuestion =
        typeof parsed.question === "string" && parsed.question.trim()
          ? parsed.question.trim()
          : null;

      await db.figure.update({
        where: { id: figure.id },
        data: {
          detailJson: JSON.stringify(parsed),
          detailStatus: "done",
          ...(refinedQuestion && refinedQuestion !== figure.question
            ? { question: refinedQuestion }
            : {}),
        },
      });

      try {
        await trackEvent(userId, "figure_detail", JSON.stringify({ paperId, figureLabel }));
      } catch {
        // ignore
      }

      return NextResponse.json({ detail: parsed, cached: false });
    } catch (e) {
      // Mark as error so the frontend can show retry
      await db.figure.update({
        where: { id: figure.id },
        data: { detailStatus: "error" },
      });
      throw e;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[figure-detail] POST failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
