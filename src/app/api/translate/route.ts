import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveLLMConfig, callLLM } from "@/lib/llm";
import { checkAndIncrement } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const { text, target = "中文" } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }
    const quota = await checkAndIncrement("translate", userId, req);
    if (!quota.ok) {
      return NextResponse.json(
        { error: `今日翻译额度已用尽（${quota.count}/${quota.limit}）。明日重置。` },
        { status: 429 }
      );
    }

    const result = await callLLM(
      cfg,
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
      {
        temperature: 0.2,
        maxTokens: 2000,
        usage: { userId, action: "translate" },
      }
    );

    return NextResponse.json({ translation: result.trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
