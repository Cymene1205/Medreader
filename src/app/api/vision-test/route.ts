import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveVisionConfig, callVisionLLM } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/vision-test
 * Tests connectivity to the user-configured Vision endpoint with a tiny
 * embedded test image (a 32×32 dark-blue square). Records token usage as
 * action="llm_test" so it appears in the admin dashboard alongside LLM
 * connection tests.
 *
 * The endpoint does NOT consume the user's daily vision quota — connection
 * tests should be free.
 */
export async function POST(req: NextRequest) {
  try {
    const vcfg = resolveVisionConfig(req);
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }
    // 32×32 dark-blue PNG (base64). Small enough that all providers accept
    // it; distinct enough that a working vision model can describe it
    // ("a small blue square" / "蓝色方块" etc.).
    const TEST_IMAGE_BASE64 =
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAACzenr0AAAAJUlEQVR42u3OQQEAAAQEMOpf2hbCmEyRTEZNTU1NTU1NTU1NTfdaG4eAAVNmcWkAAAAASUVORK5CYII=";
    const result = await callVisionLLM(
      vcfg,
      "请用一句话描述这张图片的颜色和形状。",
      TEST_IMAGE_BASE64,
      [],
      undefined,
      { userId, action: "llm_test" }
    );
    return NextResponse.json({
      ok: true,
      model: vcfg.model,
      baseUrl: vcfg.baseUrl,
      answer: (result || "").slice(0, 200),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
