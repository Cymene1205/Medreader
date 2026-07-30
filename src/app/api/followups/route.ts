import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveLLMConfig, callLLM } from "@/lib/llm";
import { trackEvent } from "@/lib/track";

export const runtime = "nodejs";
export const maxDuration = 120;

const SYSTEM_PROMPT =
  "你是一位科研文献导读助手。基于用户刚提出的问题和你的回答，结合论文内容，" +
  "生成 3 个由浅入深的延伸追问，帮助用户深入理解这篇论文。" +
  "每个问题 15-30 字，简洁有引导性。" +
  '只输出 JSON 对象 {"followUps":["问题1","问题2","问题3"]}，不要其他文字。';

/**
 * Robustly extract a string array from a DeepSeek JSON-object response.
 * Handles: bare arrays wrapped in object, arrays in various keys, and
 * raw text containing a JSON array (when json mode was bypassed).
 */
function extractFollowUps(raw: string): string[] {
  if (!raw) return [];

  // 1) Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x) => typeof x === "string").slice(0, 3);
    }
    if (parsed && typeof parsed === "object") {
      for (const key of ["followUps", "questions", "followups", "items", "list"]) {
        const v = (parsed as any)[key];
        if (Array.isArray(v)) {
          return v.filter((x: unknown) => typeof x === "string").slice(0, 3);
        }
      }
    }
  } catch {
    // fall through
  }

  // 2) Try to locate a JSON array inside the raw text
  const match = raw.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) {
        return arr.filter((x) => typeof x === "string").slice(0, 3);
      }
    } catch {
      // fall through
    }
  }

  // 3) Last resort: split by newlines and treat each non-empty line as a question
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*•\d.、]+/, "").trim())
    .filter((l) => l.length >= 5 && l.length <= 80);
  if (lines.length > 0) return lines.slice(0, 3);

  return [];
}

/**
 * POST /api/followups
 * Body: { question, answer, paperText? }
 * Returns: { followUps: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const body = await req.json();
    const { question, answer, paperText } = body || {};

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }
    if (!answer || typeof answer !== "string") {
      return NextResponse.json(
        { error: "answer is required" },
        { status: 400 }
      );
    }

    // Resolve user ID for token usage tracking.
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore
    }

    const userPrompt =
      `用户提问：\n${question.slice(0, 2000)}\n\n` +
      `你的回答：\n${answer.slice(0, 3000)}\n\n` +
      (paperText
        ? `论文片段（供参考）：\n${paperText.slice(0, 5000)}`
        : "（未提供论文片段，请基于问题与回答生成延伸追问）");

    const raw = await callLLM(
      cfg,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      {
        json: true,
        temperature: 0.5,
        maxTokens: 800,
        usage: { userId, action: "followups" },
      }
    );

    const followUps = extractFollowUps(raw);

    // Best-effort tracking
    try {
      await trackEvent(
        userId,
        "followups",
        JSON.stringify({ count: followUps.length })
      );
    } catch {
      // ignore
    }

    return NextResponse.json({ followUps });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[followups] failed:", msg);
    // Return empty array so the client can silently ignore
    return NextResponse.json({ followUps: [], error: msg });
  }
}
