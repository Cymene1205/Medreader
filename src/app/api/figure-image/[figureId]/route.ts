import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "fs/promises";
import { extname } from "path";

export const runtime = "nodejs";

/**
 * GET /api/figure-image/[figureId]
 * Streams the image file for a Figure row.
 *
 * Security:
 *   - figureId must exist in DB
 *   - imagePath is read from the row, not from query params (prevents path traversal)
 *   - we verify the imagePath is under uploads/ (defence in depth)
 *
 * Returns:
 *   200 — image bytes with correct Content-Type
 *   404 — figure not found, or imagePath missing, or file doesn't exist on disk
 *   500 — read error
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ figureId: string }> }
) {
  try {
    const { figureId } = await params;
    const figure = await db.figure.findUnique({
      where: { id: figureId },
      select: { imagePath: true, label: true, paperId: true },
    });
    if (!figure) {
      return NextResponse.json({ error: "Figure not found" }, { status: 404 });
    }
    if (!figure.imagePath) {
      return NextResponse.json(
        { error: "Figure has no associated image file" },
        { status: 404 }
      );
    }

    // Defence in depth: ensure path is under /uploads/
    // (Figure rows are only ever written by extract-figures.ts, which sets
    // imagePath from MinerU's imagesDir under uploads/, but belt-and-braces.)
    const normalized = figure.imagePath;
    if (!normalized.includes("/uploads/")) {
      return NextResponse.json(
        { error: "Image path is outside allowed directory" },
        { status: 403 }
      );
    }

    let buf: Buffer;
    try {
      buf = await readFile(normalized);
    } catch {
      return NextResponse.json(
        { error: "Image file not found on disk" },
        { status: 404 }
      );
    }

    // Determine Content-Type from extension
    const ext = extname(normalized).toLowerCase();
    const contentType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
        ? "image/gif"
        : "image/jpeg"; // default for .jpg .jpeg

    // Cache for 1 hour (figures are immutable per figureId)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, immutable",
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[figure-image] GET failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
