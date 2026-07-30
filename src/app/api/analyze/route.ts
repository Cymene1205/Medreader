import { NextRequest, NextResponse } from "next/server";
import { resolveLLMConfig, callLLM, parseJsonLoose } from "@/lib/llm";
import { trackEvent } from "@/lib/track";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { StructuredHeading } from "@/components/outline-panel";

export const runtime = "nodejs";
export const maxDuration = 300;

// 6 dimensions with their own per-dimension deep prompt.
// Each dimension gets its own dedicated DeepSeek call so the model can focus
// and produce a rich, content-grounded analysis (300-600 words).
const DIMENSIONS = [
  {
    id: "1",
    title: "科学问题",
    summaryHint: "本论文要回答的科学问题",
    prompt:
      "请基于以下论文全文，针对「科学问题」这一维度做深入分析。\n" +
      "必须回答以下子问题，每个子问题写出 1-2 段实质内容（不要空话）：\n" +
      "1. 这篇论文要解决的核心科学问题是什么？用一句话精确表述。\n" +
      "2. 这个科学问题是如何被提出的？是从什么临床/现象/前人研究的空白中产生的？引用原文关键句。\n" +
      "3. 为什么这个问题值得研究？它在生物学/医学/工程上有何意义？现有研究的不足在哪里？\n" +
      "4. 研究者的核心假设（hypothesis）是什么？\n\n" +
      "同时给出 3-5 个该维度的核心要点（每个 10-20 字），以及 1 段 10-30 字的原文定位短语（必须来自论文原文，用于跳转定位）。\n\n" +
      "输出严格 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
      '{"title":"科学问题","summary":"20-40字概括","detail":"300-600字 Markdown 结构化分析，含小标题与加粗","keyPoints":["要点1","要点2","要点3","要点4"],"quote":"原文10-30字定位短语","children":[{"id":"1-1","title":"小标题","summary":"1-2句话","keywords":["关键词1","关键词2","关键词3"],"quote":"原文10-30字片段"}]}\n\n' +
      "children 至少 2 个、最多 5 个，每个 child 必须含 keywords(3-6 个) 与 quote(必须来自原文)。",
  },
  {
    id: "2",
    title: "论证思路",
    summaryHint: "研究的整体逻辑链条",
    prompt:
      "请基于以下论文全文，针对「论证思路」这一维度做深入分析。\n" +
      "必须回答以下子问题，每个子问题写出 1-2 段实质内容（不要空话）：\n" +
      "1. 整个研究由哪几个主要部分（实验/分析模块）组成？逐个列出，并说明每个模块的研究目的。\n" +
      "2. 各模块之间的逻辑关系是什么？哪个模块的结论支撑了下一个模块的假设？画出逻辑链条。\n" +
      "3. 这种论证思路是否完整？是否跳过了某些必要的对照/验证？是否有可能替代的论证路径？\n" +
      "4. 与同领域同类研究的论证思路相比，这篇论文的思路有什么特点？\n\n" +
      "同时给出 3-5 个该维度的核心要点（每个 10-20 字），以及 1 段 10-30 字的原文定位短语（必须来自论文原文，用于跳转定位）。\n\n" +
      "输出严格 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
      '{"title":"论证思路","summary":"20-40字概括","detail":"300-600字 Markdown 结构化分析，含小标题与加粗","keyPoints":["要点1","要点2","要点3","要点4"],"quote":"原文10-30字定位短语","children":[{"id":"2-1","title":"小标题","summary":"1-2句话","keywords":["关键词1","关键词2","关键词3"],"quote":"原文10-30字片段"}]}\n\n' +
      "children 至少 2 个、最多 5 个，每个 child 必须含 keywords(3-6 个) 与 quote(必须来自原文)。",
  },
  {
    id: "3",
    title: "实验方法与结果",
    summaryHint: "主要实验方法与主要结论",
    prompt:
      "请基于以下论文全文，针对「实验方法与结果」这一维度做深入分析。\n" +
      "必须回答以下子问题，每个子问题写出 1-2 段实质内容（不要空话）：\n" +
      "1. 论文的主要结论有哪些？按重要性逐条列出，每条结论用一句话概括。\n" +
      "2. 每个结论由哪些实验/分析结果支撑？说明实验类型（如 scRNA-seq、流式细胞术、免疫荧光、Western blot、生存分析等）和关键数值（如样本量 n、p 值、fold change）。\n" +
      "3. 主要实验方法的原理与适用范围是什么？是否使用了新兴方法？\n" +
      "4. 是否有可替代的实验方法可以验证同样的结论？作者为什么选择当前方法？\n\n" +
      "同时给出 3-5 个该维度的核心要点（每个 10-20 字），以及 1 段 10-30 字的原文定位短语（必须来自论文原文，用于跳转定位）。\n\n" +
      "输出严格 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
      '{"title":"实验方法与结果","summary":"20-40字概括","detail":"300-600字 Markdown 结构化分析，含小标题与加粗","keyPoints":["要点1","要点2","要点3","要点4"],"quote":"原文10-30字定位短语","children":[{"id":"3-1","title":"小标题","summary":"1-2句话","keywords":["关键词1","关键词2","关键词3"],"quote":"原文10-30字片段"}]}\n\n' +
      "children 至少 2 个、最多 5 个，每个 child 必须含 keywords(3-6 个) 与 quote(必须来自原文)。",
  },
  {
    id: "4",
    title: "论证逻辑解析",
    summaryHint: "关键逻辑点与逻辑链条",
    prompt:
      "请基于以下论文全文，针对「论证逻辑解析」这一维度做深入分析。\n" +
      "必须回答以下子问题，每个子问题写出 1-2 段实质内容（不要空话）：\n" +
      "1. 论文中有哪些关键逻辑点（key logic points）？即那些「如果这个不成立，整篇文章结论就垮掉」的论证节点。\n" +
      "2. 总的逻辑链条是怎样的？用箭头图（文字版）表示：A → B → C → 最终结论。\n" +
      "3. 每个关键逻辑点是否有充分的实验/数据支撑？哪些点支撑较强、哪些较弱？\n" +
      "4. 是否存在循环论证、过度推断或因果倒置的风险？\n\n" +
      "同时给出 3-5 个该维度的核心要点（每个 10-20 字），以及 1 段 10-30 字的原文定位短语（必须来自论文原文，用于跳转定位）。\n\n" +
      "输出严格 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
      '{"title":"论证逻辑解析","summary":"20-40字概括","detail":"300-600字 Markdown 结构化分析，含小标题与加粗","keyPoints":["要点1","要点2","要点3","要点4"],"quote":"原文10-30字定位短语","children":[{"id":"4-1","title":"小标题","summary":"1-2句话","keywords":["关键词1","关键词2","关键词3"],"quote":"原文10-30字片段"}]}\n\n' +
      "children 至少 2 个、最多 5 个，每个 child 必须含 keywords(3-6 个) 与 quote(必须来自原文)。",
  },
  {
    id: "5",
    title: "创新性",
    summaryHint: "创新点及其意义",
    prompt:
      "请基于以下论文全文，针对「创新性」这一维度做深入分析。\n" +
      "必须回答以下子问题，每个子问题写出 1-2 段实质内容（不要空话）：\n" +
      "1. 这篇论文的核心创新点是什么？逐条列出（最多 3 条）。\n" +
      "2. 为什么这是创新点？与已有工作相比，新在哪里（新方法/新发现/新视角/新应用）？\n" +
      "3. 每个创新点属于哪方面创新？方法学创新 / 概念创新 / 应用创新 / 数据创新？\n" +
      "4. 这些创新点能衍生哪些新的研究问题？给出 2-3 个 follow-up 研究方向。\n\n" +
      "同时给出 3-5 个该维度的核心要点（每个 10-20 字），以及 1 段 10-30 字的原文定位短语（必须来自论文原文，用于跳转定位）。\n\n" +
      "输出严格 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
      '{"title":"创新性","summary":"20-40字概括","detail":"300-600字 Markdown 结构化分析，含小标题与加粗","keyPoints":["要点1","要点2","要点3","要点4"],"quote":"原文10-30字定位短语","children":[{"id":"5-1","title":"小标题","summary":"1-2句话","keywords":["关键词1","关键词2","关键词3"],"quote":"原文10-30字片段"}]}\n\n' +
      "children 至少 2 个、最多 5 个，每个 child 必须含 keywords(3-6 个) 与 quote(必须来自原文)。",
  },
  {
    id: "6",
    title: "局限性",
    summaryHint: "研究的不足与替代方案",
    prompt:
      "请基于以下论文全文，针对「局限性」这一维度做深入分析。\n" +
      "必须回答以下子问题，每个子问题写出 1-2 段实质内容（不要空话）：\n" +
      "1. 这篇论文有哪些不足？从样本量、模型选择、实验设计、数据解读、统计方法等多方面分析。\n" +
      "2. 每个不足能否找到替代方案或改进路径？具体说明。\n" +
      "3. 哪些不足是目前技术/资源无法解决的？要等到什么条件成熟才能解决？\n" +
      "4. 这些不足对论文核心结论的影响有多大？是否会动摇结论？\n\n" +
      "同时给出 3-5 个该维度的核心要点（每个 10-20 字），以及 1 段 10-30 字的原文定位短语（必须来自论文原文，用于跳转定位）。\n\n" +
      "输出严格 JSON，结构如下（不要 markdown 代码块，不要任何额外文字）：\n" +
      '{"title":"局限性","summary":"20-40字概括","detail":"300-600字 Markdown 结构化分析，含小标题与加粗","keyPoints":["要点1","要点2","要点3","要点4"],"quote":"原文10-30字定位短语","children":[{"id":"6-1","title":"小标题","summary":"1-2句话","keywords":["关键词1","关键词2","关键词3"],"quote":"原文10-30字片段"}]}\n\n' +
      "children 至少 2 个、最多 5 个，每个 child 必须含 keywords(3-6 个) 与 quote(必须来自原文)。",
  },
];

// Lightweight extraction of paper title from markdown (first H1)
function extractTitle(markdown: string, fallback: string): string {
  const m = markdown.match(/^#\s+(.+)$/m);
  return (m?.[1]?.trim() || fallback || "未命名论文").slice(0, 200);
}

// Extract H1/H2/H3 headings from MinerU markdown — these are the verbatim
// "thumbnail anchors" the user asked for. Returns {level, text}[].
// Strips any leading # marks and surrounding whitespace from the captured text.
function extractHeadings(markdown: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  if (!markdown) return out;
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) {
      out.push({ level: m[1].length, text: m[2].trim() });
    }
  }
  return out;
}

/**
 * Analyse the raw MinerU heading list AND a slice of the paper's full text
 * to produce a clean 2-level paper structure (major sections + their
 * sub-sections), with English headings translated to Chinese.
 *
 * Why we need BOTH headings and full text (per user request "基于原文分析"):
 * MinerU's H1/H2/H3 levels are often misleading — a Cell Press paper puts
 * "Novelty and Significance" as H1 with "已知 / 方法 / 结果 / 梗死心脏中... /
 * SiglecF..." all as H2 underneath. Looking at heading text alone, the LLM
 * can guess that "梗死心脏中..." is a Results sub-section, but it's much
 * more reliable when the LLM can also read the surrounding paragraph text
 * to confirm: "is this heading followed by experimental results, or by
 * journal boilerplate like author contributions?"
 *
 * So we pass BOTH:
 *   - the verbatim heading list (level + text, capped at 150 entries)
 *   - the first ~8000 chars of the paper's markdown body (contains every
 *     heading + the first 1-2 sentences after each, which is enough
 *     context for the LLM to classify each heading correctly)
 *
 * The LLM is asked to:
 *   1. Read the heading list AND the body slice to understand the paper's
 *      true structure.
 *   2. Identify real major sections (Introduction, Results, Discussion,
 *      Methods, Conclusion, Figure Legends) → kind="major".
 *   3. Identify journal boilerplate (Novelty and Significance, Highlights,
 *      Abstract, Data Availability, Abbreviations, Author Contributions,
 *      Acknowledgments, ...) → kind="metadata".
 *   4. Promote mis-nested sub-sections to their proper parent. If the
 *      paper has Results sub-sections but no Results H1, synthesise one.
 *   5. Translate every English heading to concise Chinese, preserving
 *      any <sup>/<sub> HTML tags verbatim.
 *
 * On any failure we fall back to a flat list (every heading becomes a
 * major section with no children) so the navigator still works.
 */
async function analyzeHeadings(
  headings: Array<{ level: number; text: string }>,
  paperTitle: string,
  paperBody: string,
  cfg: ReturnType<typeof resolveLLMConfig>,
  userId: string | null,
  paperId: string | null
): Promise<StructuredHeading[]> {
  if (headings.length === 0) return [];

  // Pass up to ~8000 chars of the paper body as context. This is enough
  // to cover every heading + 1-2 sentences after each, which lets the LLM
  // classify headings by what follows them (boilerplate paragraphs vs
  // experimental results) rather than by heading text alone.
  const bodySlice =
    paperBody.length > 8000 ? paperBody.slice(0, 8000) + "\n...[truncated]" : paperBody;

  const inputJson = JSON.stringify({
    paperTitle,
    bodySlice,
    headings: headings.map((h) => ({ level: h.level, text: h.text })),
  });

  const systemPrompt =
    "你是一个学术论文结构分析助手。用户会给你一篇论文的：\n" +
    "(a) 原始标题列表（从 PDF 解析的 markdown 提取的 H1/H2/H3，含 level 和 text）；\n" +
    "(b) 论文 markdown 正文的前 ~8000 字符（含每个标题及其后的 1-2 句话），作为上下文。\n\n" +
    "你的任务是结合标题列表和正文上下文，识别论文的真正结构，输出一个清晰的 2 级层级（主要章节 + 子小节），同时把英文标题翻译为中文。\n\n" +
    "【关键】必须基于正文上下文判断每个标题的真正性质，不要只看标题文本：\n" +
    "- 一个标题后面如果跟着实验数据/图表描述/具体研究发现，它就是真正的 results 子小节（即使被嵌套在 Novelty and Significance 下）；\n" +
    "- 一个标题后面如果跟着期刊样板文字（如 \"this study adds...\" / \"data are available...\" / \"authors contributed...\"），它就是 metadata。\n\n" +
    "分析规则：\n" +
    "1. 识别论文的主要章节（kind=\"major\"）。常见主要章节关键词（中英文）：\n" +
    "   引言/Introduction/Background/背景；方法/Methods/STAR Methods/Experimental Procedures；" +
    "结果/Results/Findings；讨论/Discussion；结论/Conclusion；图例/Figure Legends。\n" +
    "   把这些作为顶层 major 节点。\n\n" +
    "2. 识别期刊元数据/样板内容（kind=\"metadata\"）。常见关键词：\n" +
    "   新颖性与意义/Novelty and Significance；亮点/Highlights；摘要/Abstract；" +
    "关键资源表/Key Resources Table；数据可用性/Data Availability；作者贡献/Author Contributions；" +
    "致谢/Acknowledgments；利益冲突/Competing Interests；补充材料/Supplemental Information；" +
    "非标准缩写/Non-standard Abbreviations；已知/What is known；本文贡献的新信息/What this study adds。\n" +
    "   把这些作为顶层 metadata 节点（children 通常为空）。\n\n" +
    "3. 处理层级错位（必须基于正文判断，不要只看 markdown level）：\n" +
    "   - 如果某标题在原 markdown 中是 H2，但其内容明显是主要章节（如\"结果\"后面跟着多个结果子小节），请将其提升为 kind=\"major\" 顶层节点。\n" +
    "   - 如果原文缺少主要章节总标题（例如直接列出了\"梗死心脏中...\"\"SiglecF...\"等结果子小节，但没有\"结果\"总标题），请合成一个 kind=\"major\" 的\"结果\"节点，把那些子项归入其 children。\n" +
    "   - 子小节识别特征：通常带数字编号（如 2.1 / 2.1.1）或描述性短语（如 \"梗死心脏中...\" \"SiglecF...\" \"抗Ly6G...\"），且后面跟着具体实验数据；把它们放入对应 major 的 children 数组。\n" +
    "   - 元数据节点的子项（如\"新颖性与意义\"下的\"已知\"\"本文贡献的新信息\"\"非标准缩写\"等）保留在 metadata 节点的 children 中，不要拆出去。\n\n" +
    "4. 翻译：把每个英文标题翻译为简洁中文学术标题；保留 <sup>...</sup> 和 <sub>...</sub> HTML 标签原样不翻译；已经是中文的标题保持不变。\n\n" +
    "5. 排序：major 节点按论文出现顺序排列在前；metadata 节点排在最后；每个节点的 children 按论文出现顺序排列。\n\n" +
    "输出严格 JSON（不要 markdown 代码块，不要任何额外文字）：\n" +
    "{\n" +
    "  \"sections\": [\n" +
    "    {\n" +
    "      \"title\": \"引言\",            // 中文翻译\n" +
    "      \"origTitle\": \"Introduction\",  // 原文 verbatim\n" +
    "      \"kind\": \"major\",            // \"major\" 或 \"metadata\"\n" +
    "      \"children\": [                // 子小节（metadata 通常为空）\n" +
    "        { \"title\": \"...\", \"origTitle\": \"...\" }\n" +
    "      ]\n" +
    "    }\n" +
    "  ]\n" +
    "}";

  try {
    const raw = await callLLM(
      cfg,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: inputJson },
      ],
      {
        json: true,
        temperature: 0.1,
        maxTokens: 8000,
        usage: {
          userId,
          action: "analyze_headings",
          paperId: typeof paperId === "string" ? paperId : null,
        },
      }
    );
    const parsed = parseJsonLoose(raw) as any;
    const arr: any[] = Array.isArray(parsed?.sections)
      ? parsed.sections
      : Array.isArray(parsed)
      ? parsed
      : [];

    const sections: StructuredHeading[] = arr.map((s) => ({
      title: typeof s?.title === "string" ? s.title : "",
      origTitle: typeof s?.origTitle === "string" ? s.origTitle : "",
      kind: s?.kind === "metadata" ? "metadata" : "major",
      children: Array.isArray(s?.children)
        ? s.children
            .map((c: any) => ({
              title: typeof c?.title === "string" ? c.title : "",
              origTitle:
                typeof c?.origTitle === "string"
                  ? c.origTitle
                  : typeof c?.title === "string"
                  ? c.title
                  : "",
            }))
            .filter((c: any) => c.title && c.origTitle)
        : [],
    }));

    // Filter out entries with no title — they're useless.
    return sections.filter((s) => s.title);
  } catch (e) {
    console.warn(
      "[analyze] heading structure analysis failed, falling back to flat list:",
      e
    );
    // Fallback: every heading becomes a major section with no children.
    // We don't translate here (the LLM call failed), so we just use the
    // verbatim text. The navigator still works — just shows English.
    return headings.map((h) => ({
      title: h.text,
      origTitle: h.text,
      kind: "major" as const,
      children: [],
    }));
  }
}

export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const { text, markdown, title, paperId } = await req.json();
    // Prefer MinerU markdown (richer structure); fall back to plain text.
    const sourceText =
      typeof markdown === "string" && markdown.trim()
        ? markdown
        : typeof text === "string"
        ? text
        : "";
    if (!sourceText) {
      return NextResponse.json({ error: "text or markdown is required" }, { status: 400 });
    }

    const truncated =
      sourceText.length > 60000 ? sourceText.slice(0, 60000) + "\n...[truncated]" : sourceText;

    const paperTitle = extractTitle(sourceText, title || "");

    // Resolve user ID (anonymous allowed) for token usage tracking.
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }

    // Fire 6 parallel LLM calls — one per dimension — for much richer output.
    // Each call gets the full paper text so the model can ground its answer.
    const sectionPromises = DIMENSIONS.map(async (dim) => {
      const userPrompt =
        `论文标题：${paperTitle}\n\n论文全文（Markdown 格式，含结构信息）：\n"""\n${truncated}\n"""\n\n${dim.prompt}`;
      try {
        const raw = await callLLM(
          cfg,
          [
            {
              role: "system",
              content:
                "你是一位资深的科研文献分析助手，正在为用户生成论文的「" +
                dim.title +
                "」维度分析。" +
                "你的输出必须是合法 JSON，不能有任何额外文字、不能有 markdown 代码块标记。" +
                "所有 quote 字段必须是论文原文的逐字片段（10-30字），用于后续跳转定位。",
            },
            { role: "user", content: userPrompt },
          ],
          {
            json: true,
            temperature: 0.3,
            maxTokens: 4000,
            usage: {
              userId,
              action: "analyze",
              paperId: typeof paperId === "string" ? paperId : null,
            },
          }
        );
        const parsed = parseJsonLoose(raw) as any;
        return {
          id: dim.id,
          title: dim.title,
          summary: (parsed.summary || dim.summaryHint || "").slice(0, 120),
          detail: (parsed.detail || "").slice(0, 8000),
          keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 6) : [],
          quote: (parsed.quote || "").slice(0, 200),
          children: Array.isArray(parsed.children) ? parsed.children.slice(0, 6) : [],
        };
      } catch (e) {
        console.warn(`[analyze] dimension ${dim.id} (${dim.title}) failed:`, e);
        // Fallback: a minimal placeholder section so the rest still renders
        return {
          id: dim.id,
          title: dim.title,
          summary: "（该维度分析失败，请稍后重试）",
          detail: "",
          keyPoints: [],
          quote: "",
          children: [],
        };
      }
    });

    const sections = await Promise.all(sectionPromises);

    // Also extract the paper's verbatim H1/H2/H3 headings from MinerU markdown.
    // These are precise anchor points — clicking one jumps to the exact
    // paragraph in the block reader.
    //
    // The raw levels from MinerU are often misleading (e.g. Cell Press
    // "Novelty and Significance" H1 with "已知 / 方法 / 结果 / 梗死心脏中..."
    // all as H2 — even though the last one is a real Results sub-section).
    // So we run the heading list through an LLM that:
    //   1. Identifies the paper's true major sections (Introduction, Results,
    //      Discussion, Methods, ...) vs journal boilerplate (Novelty and
    //      Significance, Data Availability, ...).
    //   2. Re-nests sub-sections under their correct major section
    //      (promoting them out of misleading H1s when needed).
    //   3. Translates every English heading to Chinese, preserving
    //      <sup>/<sub> HTML tags.
    //
    // The output is a 2-level `structuredHeadings` tree that
    // HeadingNavigator renders directly.
    // Cap at 150 headings — long papers with many sub-sub-sections need
    // the full list to correctly classify each one. 80 was too aggressive
    // for systematic reviews / long methods sections.
    const rawHeadings = markdown ? extractHeadings(markdown).slice(0, 150) : [];
    const structuredHeadings = await analyzeHeadings(
      rawHeadings,
      paperTitle,
      sourceText,
      cfg,
      userId,
      paperId
    );

    // Track event (best-effort)
    try {
      await trackEvent(userId, "analyze", JSON.stringify({ paperId, title: paperTitle }));
    } catch {
      // ignore tracking errors
    }

    return NextResponse.json({
      outline: {
        title: paperTitle,
        sections,
        structuredHeadings,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
