import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveLLMConfig, callLLM } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/llm-test
 * Tests connectivity to the user-configured LLM endpoint with a trivial prompt.
 * Records token usage as action="llm_test" so it appears in the admin dashboard.
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }
    const answer = await callLLM(
      cfg,
      [
        { role: "system", content: "你是一个测试助手。请用最短的回答回复用户。" },
        { role: "user", content: "请回答：1+1=" },
      ],
      {
        temperature: 0,
        maxTokens: 50,
        usage: { userId, action: "llm_test" },
      }
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
