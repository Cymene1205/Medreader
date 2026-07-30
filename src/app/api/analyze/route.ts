import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek } from "@/lib/deepseek";
import { trackEvent } from "@/lib/track";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

// New 6-dimension structured prompt (Feature 4)
const SYSTEM_PROMPT = `你是一位资深的科研文献分析助手。你的任务是把一篇科学论文提炼为 6 个维度的结构化大纲，输出严格的 JSON。

6 个大维度（按顺序）必须出现，title 必须严格使用以下文本：
1. "科学问题"
2. "论证思路"
3. "实验方法与结果"
4. "论证逻辑解析"
5. "创新性"
6. "局限性"

每个维度的 detail 必须针对该维度回答用户指定的全部子问题，写出 300-600 字的结构化分析（Markdown，可含小标题、有序列表、加粗）：
1 科学问题：科学问题是什么？如何提出的？为什么需要研究？
2 论证思路：研究思路由哪几个部分组成？各部分研究目的是什么？各部分逻辑关系如何？论证思路是否完整、正确？
3 实验方法与结果：主要结论有哪些？每个结论由哪些实验组成？主要实验方法有哪些？是否有替代方案？
4 论证逻辑解析：关键逻辑点有哪些？总的逻辑链条是怎样的？
5 创新性：创新点是什么？为什么是创新点？属于哪方面创新？可衍生哪些新研究问题？
6 局限性：有哪些不足？能否找到替代方案？若目前无法解决，怎样才能解决？

输出 JSON 结构如下（字段名严格一致，不可改名）：
{
  "title": "论文标题（如有）",
  "sections": [
    {
      "id": "1",
      "title": "科学问题",
      "summary": "该维度一句话概括（20-40字）",
      "detail": "完整的结构化分析（Markdown，300-600字）",
      "keyPoints": ["要点1", "要点2", "要点3"],
      "quote": "原文10-30字定位短语（必须来自原文）",
      "children": [
        {
          "id": "1-1",
          "title": "小标题",
          "summary": "1-2句话说明",
          "keywords": ["关键词1", "关键词2"],
          "quote": "原文10-30字片段（必须来自原文）"
        }
      ]
    },
    ... (6 sections total)
  ]
}

每个 section 至少 2 个、最多 5 个 children，每个 child 必须包含 keywords（3-6 个关键词）和 quote。
keyPoints 列出该维度 3-5 个核心要点（每个 10-20 字）。

只输出 JSON 对象本身，不要任何额外文字、不要 markdown 代码块。`;

export async function POST(req: NextRequest) {
  try {
    const { text, title, paperId } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    // Allow longer text since structured parsing is denser
    const truncated =
      text.length > 30000 ? text.slice(0, 30000) + "\n...[truncated]" : text;

    const userPrompt = `请分析以下论文全文并按 6 个维度生成结构化层次化大纲。\n\n论文标题: ${title || "(未提供)"}\n\n论文全文:\n${truncated}`;

    const raw = await callDeepSeek(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { json: true, temperature: 0.3, maxTokens: 10000 }
    );

    // Robust JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const cleaned = raw
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    }

    // Track event (best-effort)
    try {
      const session = await getServerSession(authOptions);
      const userId = (session?.user as any)?.id;
      await trackEvent(userId, "analyze", JSON.stringify({ paperId, title }));
    } catch {
      // ignore tracking errors
    }

    return NextResponse.json({ outline: parsed, raw });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
