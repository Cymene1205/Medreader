import { NextRequest, NextResponse } from "next/server";
import { callVision } from "@/lib/deepseek";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { prompt, image, history, paperContext } = await req.json();
    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "image (base64 data URL) is required" },
        { status: 400 }
      );
    }

    const result = await callVision(
      prompt || "请按照四段式结构解读这张科研图表。",
      image,
      Array.isArray(history) ? history : [],
      typeof paperContext === "string" ? paperContext : undefined
    );

    return NextResponse.json({ answer: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
