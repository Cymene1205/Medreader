import { NextRequest, NextResponse } from "next/server";
import { resolveLLMConfig, callLLM } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/llm-test
 * Tests connectivity to the user-configured LLM endpoint with a trivial prompt.
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const answer = await callLLM(
      cfg,
      [
        { role: "system", content: "你是一个测试助手。请用最短的回答回复用户。" },
        { role: "user", content: "请回答：1+1=" },
      ],
      { temperature: 0, maxTokens: 50 }
    );
    return NextResponse.json({
      ok: true,
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      answer: (answer || "").slice(0, 200),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
