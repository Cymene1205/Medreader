import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/paper/[id]
 * Returns the paper's parse status and (only when status === "done") the
 * parsed text. Used by the frontend to poll an in-flight parse job.
 *
 * Response 200:
 *   { id, title, parseStatus, parsedText | null, createdAt }
 * Response 404:
 *   { error: "Paper not found" }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const paper = await db.paper.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        parseStatus: true,
        parsedText: true,
        createdAt: true,
      },
    });

    if (!paper) {
      return NextResponse.json(
        { error: "Paper not found" },
        { status: 404 }
      );
    }

    // Only expose parsedText once parsing has completed successfully.
    const parsedText =
      paper.parseStatus === "done" ? paper.parsedText : null;

    return NextResponse.json(
      {
        id: paper.id,
        title: paper.title,
        parseStatus: paper.parseStatus,
        parsedText,
        createdAt: paper.createdAt,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[paper/get] failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
