import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/paper/[id]
 * Returns the paper's parse status and parsed content.
 *
 * Response 200 (status === "done"):
 *   {
 *     id, title, parseStatus,
 *     parsedText,    // plain text fallback
 *     markdown,      // MinerU full.md (knowledge base)
 *     blocks,        // MinerU content_list.json parsed array
 *     imagesDir,     // absolute path to extracted images (server-side only)
 *     pageCount, createdAt
 *   }
 *
 * Response 200 (status === "pending"):
 *   { id, title, parseStatus: "pending", parsedText: null, ... }
 *
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
        markdown: true,
        blocksJson: true,
        imagesDir: true,
        pageCount: true,
        createdAt: true,
        citationsJson: true,
      },
    });

    if (!paper) {
      return NextResponse.json(
        { error: "Paper not found" },
        { status: 404 }
      );
    }

    const isDone = paper.parseStatus === "done";
    let blocks: unknown = null;
    if (isDone && paper.blocksJson) {
      try {
        blocks = JSON.parse(paper.blocksJson);
      } catch {
        blocks = null;
      }
    }

    let citations: unknown = null;
    if (isDone && paper.citationsJson) {
      try {
        citations = JSON.parse(paper.citationsJson);
      } catch {
        citations = null;
      }
    }

    return NextResponse.json(
      {
        id: paper.id,
        title: paper.title,
        parseStatus: paper.parseStatus,
        parsedText: isDone ? paper.parsedText : null,
        markdown: isDone ? paper.markdown : null,
        blocks,
        imagesDir: paper.imagesDir,
        pageCount: paper.pageCount,
        createdAt: paper.createdAt,
        citations,
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[paper/get] failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
