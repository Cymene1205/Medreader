import { NextRequest, NextResponse } from "next/server";
import { resolveLLMConfig, callLLM, parseJsonLoose } from "@/lib/llm";
import { trackEvent } from "@/lib/track";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { updateArgumentSpine, type AnalysisJson } from "@/lib/analyze-stage2";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/analyze
 * Body: { paperId: string, text?: string, markdown?: string, title?: string }
 *
 * Stage 1 of the new 4-layer analysis pipeline.
 *
 * Fires 3 parallel DeepSeek calls:
 *   1. questionBackground  — what's the scientific question + how it arose + significance
 *   2. novelty             — what's new (problem/method/evidence) + paradigm vs incremental
 *   3. limitsOpportunities — 2-4 limitations, EACH paired with a research opportunity
 *
 * Each call gets: paper title + first 20000 chars of parsedText/markdown.
 * Each returns: { summary: 60-120 chars, detail: Markdown 200-400 chars }.
 *
 * argumentSpine is left null at this stage — it's filled in by Stage 2
 * (updateArgumentSpine in analyze-stage2.ts), which is triggered by
 * /api/figures after Call A (figure analysis) completes.
 *
 * Idempotent: if Paper.analysisJson already exists, returns it directly.
 * Failure handling: if any of the 3 calls fails, the corresponding field
 * is set to null and its name is added to `failedParts`. The frontend
 * shows a "生成失败 · 重试" button for those parts. Retries can be done
 * via POST /api/analyze?part=questionBackground (etc) — see retryPart().
 *
 * The response shape is the OLD shape ({ outline: {...} }) for backwards
 * compatibility with the existing frontend, but the contents of `outline`
 * now follow the new 4-layer structure:
 *   {
 *     title: string,
 *     questionBackground, argumentSpine, novelty, limitsOpportunities, failedParts,
 *     // Legacy fields (empty arrays / null) preserved so old UI doesn't crash:
 *     sections: [],
 *     structuredHeadings: null,
 *   }
 */

// ---------------------------------------------------------------------------
// Per-part prompts
// ---------------------------------------------------------------------------

const PROMPT_QUESTION_BACKGROUND = `请基于以下论文全文，针对「问题与背景」做深入分析。
必须按 3 个子模块组织内容，每个子模块独立成段：
1. 核心科学问题 —— 这篇论文要回答的核心科学问题是什么？用一句话精确表述，再用 1-2 句解释其科学价值。
2. 问题由来 —— 这个科学问题是如何从领域空白或临床现象中产生的？用自己的话解释其来龙去脉。
3. 已有不足 —— 已有研究有什么不足？为什么这个问题值得现在研究？

⚠️ 重要要求：
- 用中文回答，所有内容必须是你的概括与解释，不要直接复制粘贴论文英文原文。
- 如果提到关键概念（如疾病名、分子名、技术名），可以用括号附上英文术语，但不要整句引用原文。
- 输出要专业、清晰、易读，让医学研究者快速理解。

输出严格 JSON（不要 markdown 代码块，不要任何额外文字）：
{
  "summary": "60-120字概括",
  "subsections": [
    {
      "heading": "核心科学问题",
      "body": "80-180字段落说明",
      "bullets": ["可选 1-3 条要点，每条 10-30 字"]
    },
    {
      "heading": "问题由来",
      "body": "80-180字段落说明",
      "bullets": ["可选 1-3 条要点"]
    },
    {
      "heading": "已有不足",
      "body": "80-180字段落说明",
      "bullets": ["可选 1-3 条要点"]
    }
  ]
}`;

const PROMPT_NOVELTY = `请基于以下论文全文，针对「创新性」做深入分析。
必须按 2-4 个子模块组织内容（每条创新点为一个子模块，按重要性排序）：
- 每个子模块的 heading 形如：「创新点 1：xxx」
- body：80-180 字说明该创新点的具体内容、与已有工作的差异
- bullets：必含 2 条 ——
    · "类型：问题新 / 方法新 / 证据新 / 视角新"（择一）
    · "判断：渐进式 / 范式级 —— 简短理由"

⚠️ 重要要求：
- 用中文回答，所有内容必须是你的概括与解释，不要直接复制粘贴论文英文原文。
- 关键术语可在括号中附英文，但不要整句引用原文。

输出严格 JSON（不要 markdown 代码块，不要任何额外文字）：
{
  "summary": "60-120字概括",
  "subsections": [
    {
      "heading": "创新点 1：xxx",
      "body": "80-180字段落说明",
      "bullets": ["类型：方法新", "判断：渐进式 —— 简短理由"]
    },
    {
      "heading": "创新点 2：xxx",
      "body": "80-180字段落说明",
      "bullets": ["类型：证据新", "判断：范式级 —— 简短理由"]
    }
  ]
}`;

const PROMPT_LIMITS_OPPORTUNITIES = `请基于以下论文全文，针对「局限与机会」做深入分析。
必须列出 2-4 条局限，每条局限独立成一个子模块（subsection）：
- 每个子模块的 heading 就是该局限的简短描述（10-25 字）
- body：80-180 字详细说明该局限的具体表现与影响
- bullets：必含 1-2 条 ——
    · "机会：xxx"（10-30 字，由该局限衍生的可探究课题）
    · 可选 "维度：样本量/模型选择/实验设计/数据解读/统计方法/外推性"（择一）

⚠️ 重要要求：
- 用中文回答，所有内容必须是你的概括与解释，不要直接复制粘贴论文英文原文。

输出严格 JSON（不要 markdown 代码块，不要任何额外文字）：
{
  "summary": "60-120字概括",
  "subsections": [
    {
      "heading": "样本量不足",
      "body": "80-180字段落说明该局限",
      "bullets": ["机会：扩展到多中心队列验证", "维度：样本量"]
    },
    {
      "heading": "xxx",
      "body": "80-180字段落说明",
      "bullets": ["机会：xxx"]
    }
  ],
  "pairs": [
    {"limitation":"10-30字","opportunity":"10-30字 可探究课题"}
  ]
}

注意：pairs 字段仍需保留（用于限制/机会对照表导出），内容可与 subsections 互相呼应。`;

// ---------------------------------------------------------------------------
// Per-part call helper
// ---------------------------------------------------------------------------

async function callOnePart(
  cfg: ReturnType<typeof resolveLLMConfig>,
  systemPrompt: string,
  paperTitle: string,
  paperBody: string,
  userId: string | null,
  paperId: string | null,
  action: string
): Promise<{
  summary: string;
  detail: string;
  subsections: Array<{ heading: string; body: string; bullets: string[] }>;
} | null> {
  try {
    const truncated =
      paperBody.length > 20000 ? paperBody.slice(0, 20000) + "\n...[truncated]" : paperBody;
    const raw = await callLLM(
      cfg,
      [
        {
          role: "system",
          content:
            "你是一位资深的科研文献分析助手，正在为用户生成论文的「" +
            systemPrompt.split("，针对「")[1]?.split("」")[0] +
            "」分析。你的输出必须是合法 JSON，不能有任何额外文字、不能有 markdown 代码块标记。" +
            "你必须用自己的话概括与解释论文内容，不要直接复制粘贴论文原文的整句或整段。" +
            "如果需要提及关键概念（如疾病名、分子名、技术名），可在括号中附上英文术语，但不要大段引用英文原文。" +
            "subsections 字段必须存在且为数组，每个元素含 heading（字符串）、body（字符串）、bullets（字符串数组，可为空数组）。",
        },
        {
          role: "user",
          content: `论文标题：${paperTitle}\n\n论文全文（Markdown 格式，含结构信息）：\n"""\n${truncated}\n"""\n\n${systemPrompt}`,
        },
      ],
      {
        json: true,
        temperature: 0.3,
        maxTokens: 4000,
        usage: {
          userId,
          action,
          paperId: typeof paperId === "string" ? paperId : null,
        },
      }
    );
    const parsed = parseJsonLoose(raw) as any;
    const summary = typeof parsed?.summary === "string" ? parsed.summary.slice(0, 200) : "";
    // 兼容老格式：如果 LLM 没返回 subsections，从 detail 拆出 markdown ## 标题段
    let subsections: Array<{ heading: string; body: string; bullets: string[] }> = [];
    if (Array.isArray(parsed?.subsections)) {
      subsections = parsed.subsections
        .filter((s: any) => s && typeof s.heading === "string" && typeof s.body === "string")
        .slice(0, 6)
        .map((s: any) => ({
          heading: String(s.heading).slice(0, 100),
          body: String(s.body).slice(0, 1200),
          bullets: Array.isArray(s.bullets)
            ? s.bullets.filter((b: any) => typeof b === "string").slice(0, 5).map((b: any) => String(b).slice(0, 200))
            : [],
        }));
    }
    let detail = typeof parsed?.detail === "string" ? parsed.detail.slice(0, 8000) : "";
    // 如果没有 detail 但有 subsections，自动合成一份 markdown detail 用于导出/兜底渲染
    if (!detail && subsections.length > 0) {
      detail = subsections
        .map((s) => `### ${s.heading}\n\n${s.body}${s.bullets.length > 0 ? "\n\n- " + s.bullets.join("\n- ") : ""}`)
        .join("\n\n");
    }
    if (!summary && subsections.length === 0 && !detail) {
      throw new Error("Empty LLM response");
    }
    return { summary, detail, subsections };
  } catch (e) {
    console.warn(`[analyze] ${action} failed:`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const url = new URL(req.url);
    const retryPart = url.searchParams.get("part"); // if set, only redo this part

    const body = await req.json();
    const { paperId, text, markdown, title } = body as {
      paperId?: string;
      text?: string;
      markdown?: string;
      title?: string;
    };

    if (!paperId) {
      return NextResponse.json(
        { error: "paperId is required (new 4-layer pipeline reads from DB)" },
        { status: 400 }
      );
    }

    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }

    // Load paper from DB
    const paper = await db.paper.findUnique({
      where: { id: paperId },
      select: {
        id: true,
        title: true,
        markdown: true,
        parsedText: true,
        analysisJson: true,
      },
    });
    if (!paper) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }

    // Source text for LLM: prefer DB markdown, fallback to DB parsedText,
    // then to the body-passed text/markdown (legacy clients).
    const sourceText =
      (paper.markdown && paper.markdown.trim()) ||
      (paper.parsedText && paper.parsedText.trim()) ||
      (typeof markdown === "string" && markdown.trim()) ||
      (typeof text === "string" && text.trim()) ||
      "";
    if (!sourceText) {
      return NextResponse.json(
        { error: "No paper text available — MinerU parse may still be in progress" },
        { status: 400 }
      );
    }

    // Prefer the DB-stored title (which is the real paper title extracted
    // from MinerU blocks after parsing — see /api/upload). Fall back to the
    // filename passed by the client only if the DB title is missing.
    // The client sends `title = file.name` which is just the PDF filename
    // and is a poor title — but we keep it as a last-resort fallback.
    const paperTitle = paper.title || title || "未命名论文";

    // Parse existing analysisJson (if any) so we can do partial retries
    let analysis: AnalysisJson;
    if (paper.analysisJson) {
      try {
        analysis = JSON.parse(paper.analysisJson) as AnalysisJson;
        // Sync the title — older analyses may have stored the PDF filename
        // as the title (before extractPaperTitle was added). Always prefer
        // the current DB title so the UI shows the real paper title.
        if (analysis.title !== paperTitle) {
          analysis.title = paperTitle;
        }
      } catch {
        analysis = {
          title: paperTitle,
          questionBackground: null,
          argumentSpine: null,
          novelty: null,
          limitsOpportunities: null,
          failedParts: ["questionBackground", "novelty", "limitsOpportunities"],
        };
      }
    } else {
      analysis = {
        title: paperTitle,
        questionBackground: null,
        argumentSpine: null,
        novelty: null,
        limitsOpportunities: null,
        failedParts: ["questionBackground", "novelty", "limitsOpportunities"],
      };
    }

    // Determine which parts to (re)generate
    const partsToRun: string[] = [];
    if (retryPart) {
      // Partial retry — only run the requested part
      if (["questionBackground", "novelty", "limitsOpportunities"].includes(retryPart)) {
        partsToRun.push(retryPart);
      }
    } else {
      // Full run — only if not all parts already done
      const allDone =
        analysis.questionBackground &&
        analysis.novelty &&
        analysis.limitsOpportunities;
      if (allDone && !retryPart) {
        // Return cache — figures + spine may still be in progress, that's OK
        return NextResponse.json({ outline: analysis, cached: true });
      }
      partsToRun.push("questionBackground", "novelty", "limitsOpportunities");
    }

    // Fire the 3 calls in parallel (or just the one for partial retry)
    const tasks: Array<Promise<void>> = [];

    if (partsToRun.includes("questionBackground")) {
      tasks.push(
        callOnePart(
          cfg,
          PROMPT_QUESTION_BACKGROUND,
          paperTitle,
          sourceText,
          userId,
          paperId,
          "analyze_question_background"
        ).then((r) => {
          analysis.questionBackground = r;
          if (r) {
            analysis.failedParts = analysis.failedParts.filter((p) => p !== "questionBackground");
          } else if (!analysis.failedParts.includes("questionBackground")) {
            analysis.failedParts.push("questionBackground");
          }
        })
      );
    }
    if (partsToRun.includes("novelty")) {
      tasks.push(
        callOnePart(
          cfg,
          PROMPT_NOVELTY,
          paperTitle,
          sourceText,
          userId,
          paperId,
          "analyze_novelty"
        ).then((r) => {
          analysis.novelty = r;
          if (r) {
            analysis.failedParts = analysis.failedParts.filter((p) => p !== "novelty");
          } else if (!analysis.failedParts.includes("novelty")) {
            analysis.failedParts.push("novelty");
          }
        })
      );
    }
    if (partsToRun.includes("limitsOpportunities")) {
      tasks.push(
        (async () => {
          try {
            const truncated =
              sourceText.length > 20000
                ? sourceText.slice(0, 20000) + "\n...[truncated]"
                : sourceText;
            const raw = await callLLM(
              cfg,
              [
                {
                  role: "system",
                  content:
                    "你是一位资深的科研文献分析助手，正在为用户生成论文的「局限与机会」分析。" +
                    "你的输出必须是合法 JSON，不能有任何额外文字、不能有 markdown 代码块标记。",
                },
                {
                  role: "user",
                  content: `论文标题：${paperTitle}\n\n论文全文（Markdown 格式）：\n"""\n${truncated}\n"""\n\n${PROMPT_LIMITS_OPPORTUNITIES}`,
                },
              ],
              {
                json: true,
                temperature: 0.3,
                maxTokens: 4000,
                usage: {
                  userId,
                  action: "analyze_limits_opportunities",
                  paperId,
                },
              }
            );
            const parsed = parseJsonLoose(raw) as any;
            if (parsed && typeof parsed.summary === "string") {
              // Parse subsections array (new structured format)
              let subsections: Array<{ heading: string; body: string; bullets: string[] }> = [];
              if (Array.isArray(parsed.subsections)) {
                subsections = parsed.subsections
                  .filter((s: any) => s && typeof s.heading === "string" && typeof s.body === "string")
                  .slice(0, 6)
                  .map((s: any) => ({
                    heading: String(s.heading).slice(0, 100),
                    body: String(s.body).slice(0, 1200),
                    bullets: Array.isArray(s.bullets)
                      ? s.bullets.filter((b: any) => typeof b === "string").slice(0, 5).map((b: any) => String(b).slice(0, 200))
                      : [],
                  }));
              }
              let detail = (typeof parsed.detail === "string" ? parsed.detail : "").slice(0, 8000);
              // 如果没有 detail 但有 subsections，自动合成 markdown detail 用于导出/兜底
              if (!detail && subsections.length > 0) {
                detail = subsections
                  .map((s) => `### ${s.heading}\n\n${s.body}${s.bullets.length > 0 ? "\n\n- " + s.bullets.join("\n- ") : ""}`)
                  .join("\n\n");
              }
              analysis.limitsOpportunities = {
                summary: parsed.summary.slice(0, 200),
                detail,
                subsections,
                pairs: Array.isArray(parsed.pairs)
                  ? parsed.pairs
                      .filter(
                        (p: any) =>
                          p && typeof p.limitation === "string" && typeof p.opportunity === "string"
                      )
                      .slice(0, 5)
                      .map((p: any) => ({
                        limitation: String(p.limitation).slice(0, 200),
                        opportunity: String(p.opportunity).slice(0, 200),
                      }))
                  : [],
              };
              analysis.failedParts = analysis.failedParts.filter(
                (p) => p !== "limitsOpportunities"
              );
            } else {
              throw new Error("Invalid limitsOpportunities response");
            }
          } catch (e) {
            console.warn("[analyze] limitsOpportunities failed:", e);
            analysis.limitsOpportunities = null;
            if (!analysis.failedParts.includes("limitsOpportunities")) {
              analysis.failedParts.push("limitsOpportunities");
            }
          }
        })()
      );
    }

    await Promise.all(tasks);

    // Persist analysisJson to DB
    await db.paper.update({
      where: { id: paperId },
      data: { analysisJson: JSON.stringify(analysis) },
    });

    // Best-effort: try to update argumentSpine if figures are already analyzed.
    // If figures aren't ready yet (Call A hasn't run), this is a no-op.
    try {
      await updateArgumentSpine(paperId, cfg, userId);
      // Re-read the updated analysisJson so we return the latest version
      const refreshed = await db.paper.findUnique({
        where: { id: paperId },
        select: { analysisJson: true },
      });
      if (refreshed?.analysisJson) {
        analysis = JSON.parse(refreshed.analysisJson) as AnalysisJson;
      }
    } catch (e) {
      console.warn("[analyze] post-stage2 update failed (non-fatal):", e);
    }

    // Track event (best-effort)
    try {
      await trackEvent(userId, "analyze", JSON.stringify({ paperId, title: paperTitle }));
    } catch {
      // ignore
    }

    return NextResponse.json({ outline: analysis, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[analyze] POST failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/analyze?paperId=...
 * Returns the current analysisJson for a paper (no LLM call).
 * Used by the frontend to poll for Stage 2 (argumentSpine) updates.
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
    const paper = await db.paper.findUnique({
      where: { id: paperId },
      select: { analysisJson: true, title: true },
    });
    if (!paper) {
      return NextResponse.json({ error: "Paper not found" }, { status: 404 });
    }
    let analysis: AnalysisJson | null = null;
    if (paper.analysisJson) {
      try {
        analysis = JSON.parse(paper.analysisJson) as AnalysisJson;
      } catch {
        analysis = null;
      }
    }
    return NextResponse.json({ outline: analysis });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
