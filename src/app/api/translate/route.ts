import { NextRequest, NextResponse } from "next/server";
import { callDeepSeek } from "@/lib/deepseek";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { text, target = "中文" } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const result = await callDeepSeek(
      [
        {
          role: "system",
          content:
            "你是一位专业的科技文献翻译。把用户给定的英文（或其它语言）片段翻译成" +
            target +
            "。要求：保留专业术语的原文括注，句子通顺、忠于原文，不要任何解释性补充，不要前后缀。",
        },
        { role: "user", content: text },
      ],
      { temperature: 0.2, maxTokens: 2000 }
    );

    return NextResponse.json({ translation: result.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
