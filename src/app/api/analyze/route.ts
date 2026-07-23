import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek } from "@/lib/deepseek";

export const runtime = "nodejs";
export const maxDuration = 300;

// 6-dimension outline prompt
const SYSTEM_PROMPT = `你是一位资深的科研文献分析助手。你的任务是把一篇科学论文提炼为 6 个维度的层次化大纲，输出严格的 JSON。

输出 JSON 结构如下（字段名严格一致，不可改名）：
{
  "title": "论文标题（如有）",
  "sections": [
    {
      "id": "1",
      "title": "科学问题如何提出，有什么意义？",
      "summary": "这一节的一句话概述",
      "children": [
        {
          "id": "1-1",
          "title": "小标题（例如：流行病学关联）",
          "summary": "1-2 句话说明",
          "keywords": ["流行病学", "Parity", "TNBC"],
          "quote": "原文中可以用来定位该小节的 10-30 字关键短语（必须来自原文）"
        }
      ]
    },
    ...
  ]
}

6 个大维度（按顺序）必须出现，title 必须严格使用以下文本：
1. "科学问题如何提出，有什么意义？"
2. "逻辑上如何证明科学问题，研究内容是什么？"
3. "关键的实验技术有哪些？"
4. "从文章逻辑性中找到逻辑链接的关键点，并阐明关键点的重要意义。"
5. "逻辑总结"
6. "基于这篇文章能进一步衍生的课题有哪些？"

每个大维度下至少 2 个、最多 5 个 children，每个 child 必须包含 keywords（3-6 个关键词，用于在原文中检索定位）和 quote（10-30 字原文片段，用于精确跳转）。

只输出 JSON 对象本身，不要任何额外文字、不要 markdown 代码块。`;

export async function POST(req: NextRequest) {
  try {
    const { text, title } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    // Truncate very long text to ~12000 chars to keep prompt manageable
    const truncated =
      text.length > 12000 ? text.slice(0, 12000) + "\n...[truncated]" : text;

    const userPrompt = `请分析以下论文全文并按 6 个维度生成层次化大纲。\n\n论文标题: ${title || "(未提供)"}\n\n论文全文:\n${truncated}`;

    const raw = await callDeepSeek(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { json: true, temperature: 0.2, maxTokens: 6000 }
    );

    // Robust JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // try to strip code fence
      const cleaned = raw
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    }

    return NextResponse.json({ outline: parsed, raw });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
