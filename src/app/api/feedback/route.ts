import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { trackEvent } from "@/lib/track";

export const runtime = "nodejs";

/**
 * POST /api/feedback
 * Body: { chatLogId, type: "up" | "down", reason?: string }
 *
 * - Authenticated users: upsert by (chatLogId, userId) so re-clicking
 *   updates their existing feedback (toggle / change reason).
 * - Anonymous users: simply create a new record each time (allowed since
 *   the @@unique([chatLogId, userId]) constraint treats NULL userIds as
 *   distinct in SQLite).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chatLogId, type, reason } = body || {};

    if (!chatLogId || typeof chatLogId !== "string") {
      return NextResponse.json(
        { error: "chatLogId is required" },
        { status: 400 }
      );
    }
    if (type !== "up" && type !== "down") {
      return NextResponse.json(
        { error: "type must be 'up' or 'down'" },
        { status: 400 }
      );
    }

    const session = await getServerSession(authOptions);
    const userId: string | null = (session?.user as any)?.id ?? null;

    // Verify the chat log exists so we don't create orphan feedback
    const chatLog = await db.chatLog.findUnique({
      where: { id: chatLogId },
      select: { id: true },
    });
    if (!chatLog) {
      return NextResponse.json(
        { error: "chatLog not found" },
        { status: 404 }
      );
    }

    const reasonValue =
      typeof reason === "string" && reason.trim()
        ? reason.trim().slice(0, 2000)
        : null;

    let feedback;
    if (userId) {
      // Upsert by (chatLogId, userId) — the @@unique constraint guarantees
      // one feedback per user per chat log.
      feedback = await db.feedback.upsert({
        where: { chatLogId_userId: { chatLogId, userId } },
        create: {
          chatLogId,
          userId,
          type,
          reason: reasonValue,
        },
        update: {
          type,
          reason: reasonValue,
        },
      });
    } else {
      // Anonymous — just create. Multiple anonymous feedbacks per chat log
      // are permitted (NULL userIds don't conflict under SQLite).
      feedback = await db.feedback.create({
        data: {
          chatLogId,
          userId: null,
          type,
          reason: reasonValue,
        },
      });
    }

    // Best-effort tracking
    try {
      await trackEvent(
        userId,
        "feedback",
        JSON.stringify({ chatLogId, type, hasReason: !!reasonValue })
      );
    } catch {
      // ignore
    }

    return NextResponse.json({
      ok: true,
      feedback: { type: feedback.type, reason: feedback.reason },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[feedback] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
