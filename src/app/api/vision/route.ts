import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveLLMConfig, callVisionLLM } from "@/lib/llm";
import { checkAndIncrement } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const { prompt, image, history, paperContext } = await req.json();
    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "image (base64 data URL) is required" },
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
    const quota = await checkAndIncrement("vision", userId, req);
    if (!quota.ok) {
      return NextResponse.json(
        { error: `今日图片提问额度已用尽（${quota.count}/${quota.limit}）。明日重置。` },
        { status: 429 }
      );
    }

    const result = await callVisionLLM(
      cfg,
      prompt || "请按照四段式结构解读这张科研图表。",
      image,
      Array.isArray(history) ? history : [],
      typeof paperContext === "string" ? paperContext : undefined,
      { userId, action: "vision" }
    );

    return NextResponse.json({ answer: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
