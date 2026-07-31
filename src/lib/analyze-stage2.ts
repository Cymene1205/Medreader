/**
 * analyze-stage2.ts — Stage 2 of the new 4-layer analysis pipeline.
 *
 * This module is responsible for the part of /api/analyze that depends on
 * figures being available:
 *   - argumentSpine: the narrative summary that strings figures together
 *
 * It's split into its own module so /api/figures can call into it after
 * Call A completes (figures become available) without creating a circular
 * import with /api/analyze.
 *
 * Flow:
 *   1. (Stage 1) /api/analyze fires 3 parallel LLM calls
 *      (questionBackground / novelty / limitsOpportunities) and stores
 *      analysisJson with argumentSpine=null placeholder.
 *   2. (Stage 2) /api/figures fires Call A (batch figure analysis)
 *      → on success calls updateArgumentSpine() from this module.
 *   3. updateArgumentSpine() fires a lightweight LLM call (maxTokens=500)
 *      to generate the 80-150 char narrative summary, then patches
 *      analysisJson.argumentSpine in place.
 *
 * Failure modes:
 *   - LLM call fails → fall back to template concatenation of figure
 *     questions in chainIndex order.
 *   - DB read fails → return without updating (non-fatal).
 *   - analysisJson doesn't exist yet (Stage 1 hasn't run) → no-op.
 */

import { db } from "@/lib/db";
import { callLLM, parseJsonLoose, type LLMConfig } from "@/lib/llm";

export type Subsection = {
  heading: string;
  body: string;
  bullets: string[];
};

export type AnalysisJson = {
  title: string;
  questionBackground: {
    summary: string;
    detail: string;
    subsections?: Subsection[];
  } | null;
  argumentSpine: { summary: string; linchpinFigure: string | null } | null;
  novelty: {
    summary: string;
    detail: string;
    subsections?: Subsection[];
  } | null;
  limitsOpportunities: {
    summary: string;
    detail: string;
    subsections?: Subsection[];
    pairs: Array<{ limitation: string; opportunity: string }>;
  } | null;
  failedParts: string[];
};

/**
 * Build the argumentSpine — the 80-150 char narrative summary that strings
 * all figures together by chainIndex order, with the linchpin figure called
 * out by label.
 *
 * Two strategies:
 *   1. LLM call (preferred): pass figure labels + questions + linchpin
 *      marker to DeepSeek, get back a fluent one-paragraph summary.
 *   2. Template fallback (if LLM fails or figures have no questions):
 *      concatenate questions in order: "本文先通过 Fig 1 发现…，进而 Fig 2
 *      证实…，命门在 Fig 3…".
 *
 * Either way, the result is written into Paper.analysisJson.argumentSpine,
 * preserving the other 3 parts.
 */
export async function updateArgumentSpine(
  paperId: string,
  cfg: LLMConfig,
  userId: string | null
): Promise<void> {
  // Load paper + figures
  const paper = await db.paper.findUnique({
    where: { id: paperId },
    select: { analysisJson: true, title: true, figures: { orderBy: { order: "asc" } } },
  });
  if (!paper) return;

  // Parse existing analysisJson (if Stage 1 hasn't run, this is a no-op)
  let analysis: AnalysisJson;
  if (paper.analysisJson) {
    try {
      analysis = JSON.parse(paper.analysisJson) as AnalysisJson;
    } catch {
      // Corrupt JSON — start fresh with a minimal stub
      analysis = {
        title: paper.title,
        questionBackground: null,
        argumentSpine: null,
        novelty: null,
        limitsOpportunities: null,
        failedParts: [],
      };
    }
  } else {
    // Stage 1 hasn't run yet — can't write spine without analysisJson.
    // (Stage 2 normally only fires after Stage 1, but defensive.)
    return;
  }

  // Sort figures by chainIndex (nulls last, preserving original order for ties)
  const sortedFigs = [...paper.figures].sort((a, b) => {
    if (a.chainIndex == null && b.chainIndex == null) return a.order - b.order;
    if (a.chainIndex == null) return 1;
    if (b.chainIndex == null) return -1;
    return a.chainIndex - b.chainIndex;
  });

  const linchpinFig = sortedFigs.find((f) => f.isLinchpin) || null;
  const figsWithQ = sortedFigs.filter((f) => f.question);

  let summary = "";
  let llmSucceeded = false;

  // === Strategy A: figures with questions available — figure-anchored spine ===
  if (figsWithQ.length > 0) {
    // Try LLM first
    try {
      const systemPrompt =
        "你是科研论文论证主线总结助手。请根据论文每张主图回答的科学问题，生成一段 80-150 字的论证主线。" +
        "格式参考：'本文先通过 Fig 1 发现…，进而 Fig 2 证实…，命门在 Fig 3…'。" +
        "命门图（isLinchpin=true）必须在文中明确点出，并在该句末尾用【】标记图号。\n" +
        "只输出主线一段话，不要任何额外文字、不要换行。";

      const figContext = figsWithQ
        .map(
          (f) =>
            `${f.label}（${f.role || "未分类"}${f.isLinchpin ? "，命门" : ""}）：${f.question}`
        )
        .join("\n");

      const raw = await callLLM(
        cfg,
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `论文标题：${paper.title}\n\n各图问句：\n${figContext}`,
          },
        ],
        {
          temperature: 0.3,
          maxTokens: 500,
          usage: {
            userId,
            action: "argument_spine",
            paperId,
          },
        }
      );
      summary = raw.trim().slice(0, 300);
      if (summary.length >= 20) llmSucceeded = true;
    } catch (e) {
      console.warn("[analyze-stage2] spine LLM failed, falling back to template:", e);
    }

    // Template fallback (figure-anchored)
    if (!llmSucceeded) {
      const parts: string[] = [];
      figsWithQ.forEach((f, i) => {
        const short = (f.question || "").slice(0, 40);
        const connector =
          i === 0
            ? `本文先通过 ${f.label} 发现`
            : i === figsWithQ.length - 1 && figsWithQ.length > 1
            ? `，最终 ${f.label} 证实`
            : `，进而 ${f.label} 证实`;
        parts.push(`${connector}${short}`);
        if (f.isLinchpin) {
          parts.push(`（命门在 ${f.label}）`);
        }
      });
      summary = parts.join("") + "。";
    }
  } else {
    // === Strategy B: NO figures (or no questions) — text-only spine ===
    // 之前会直接 return 不生成 spine，UI 显示"无图表数据"。
    // 现在改用论文文字（markdown 或 parsedText）生成纯文字版论证主线。
    console.log("[analyze-stage2] no figures with questions, falling back to text-only spine");

    // Load paper text content
    const paperWithText = await db.paper.findUnique({
      where: { id: paperId },
      select: { markdown: true, parsedText: true, title: true },
    });
    const fullText = (paperWithText?.markdown || paperWithText?.parsedText || "").slice(0, 8000);

    if (fullText.length < 50) {
      // Truly nothing to summarize — give up
      console.warn("[analyze-stage2] no text content available, cannot build spine");
      return;
    }

    try {
      const systemPrompt =
        "你是科研论文论证主线总结助手。请根据论文原文，生成一段 100-200 字的论证主线总结。" +
        "要求：\n" +
        "1. 用流畅的中文叙述论文的核心论证逻辑（提出什么问题 → 用什么方法 → 发现什么 → 结论是什么）\n" +
        "2. 不要罗列图表，聚焦在论证脉络上\n" +
        "3. 只输出主线一段话，不要任何额外文字、不要换行、不要标题";

      const raw = await callLLM(
        cfg,
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `论文标题：${paper.title}\n\n论文原文（截断）：\n${fullText}`,
          },
        ],
        {
          temperature: 0.3,
          maxTokens: 600,
          usage: {
            userId,
            action: "argument_spine_text",
            paperId,
          },
        }
      );
      summary = raw.trim().slice(0, 400);
      if (summary.length >= 20) llmSucceeded = true;
    } catch (e) {
      console.warn("[analyze-stage2] text-only spine LLM failed:", e);
    }

    // Final fallback: first 150 chars of paper text
    if (!llmSucceeded) {
      summary = `（文字摘要模式）${fullText.slice(0, 150).replace(/\s+/g, " ").trim()}…`;
    }
  }

  // Write back
  analysis.argumentSpine = {
    summary,
    linchpinFigure: linchpinFig?.label || null,
  };

  await db.paper.update({
    where: { id: paperId },
    data: { analysisJson: JSON.stringify(analysis) },
  });
}
