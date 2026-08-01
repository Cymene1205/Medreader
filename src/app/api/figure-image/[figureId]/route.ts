import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "fs/promises";
import { extname, resolve, relative, isAbsolute } from "path";

export const runtime = "nodejs";

// Uploads root — must match `UPLOADS_DIR` env var. Resolved to an
// absolute path so `relative()` checks below are reliable.
const ALLOWED_ROOT = resolve(process.env.UPLOADS_DIR || "/home/z/my-project/uploads");

/**
 * GET /api/figure-image/[figureId]
 * Streams the image file for a Figure row.
 *
 * Security:
 *   - figureId must exist in DB
 *   - imagePath is read from the row, not from query params (prevents path traversal)
 *   - we verify the imagePath resolves UNDER ALLOWED_ROOT (defence in depth)
 *
 * Returns:
 *   200 — image bytes with correct Content-Type
 *   404 — figure not found, or imagePath missing, or file doesn't exist on disk
 *   403 — imagePath escapes ALLOWED_ROOT (would indicate DB corruption or attack)
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

    // Defence in depth: ensure path resolves UNDER ALLOWED_ROOT.
    // Previous check used `includes("/uploads/")` which is bypassable
    // by sibling directories like `/home/z/my-project/uploads-evil/foo.jpg`.
    // `path.relative` is the correct primitive — see paper-images route
    // for detailed comments on why.
    const resolved = resolve(figure.imagePath);
    const rel = relative(ALLOWED_ROOT, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      console.error(
        `[figure-image] SECURITY: figure ${figureId} imagePath escapes ALLOWED_ROOT: ` +
        `${figure.imagePath} (resolved=${resolved}, ALLOWED_ROOT=${ALLOWED_ROOT})`
      );
      return NextResponse.json(
        { error: "Image path is outside allowed directory" },
        { status: 403 }
      );
    }

    let buf: Buffer;
    try {
      buf = await readFile(resolved);
    } catch {
      return NextResponse.json(
        { error: "Image file not found on disk" },
        { status: 404 }
      );
    }

    // Determine Content-Type from extension
    const ext = extname(resolved).toLowerCase();
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
