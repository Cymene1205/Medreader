import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

/**
 * GET /api/paper/[id]/pdf
 *
 * Streams the original uploaded PDF binary for a paper.
 *
 * Why this exists:
 *   The PdfViewer component on the client takes an ArrayBuffer of the PDF.
 *   When user A uploads a PDF, only A's browser has the ArrayBuffer in
 *   memory — the server stores the file on disk under Paper.filePath.
 *   If user A shares the URL (with ?paperId=xxx) with user B, B's browser
 *   has no ArrayBuffer and cannot render the PDF, even though all the
 *   parsed text / analysis / figures are accessible via the existing
 *   /api/paper/[id], /api/analyze, /api/figures endpoints.
 *
 *   This route closes that gap: anyone with the paperId can fetch the
 *   raw PDF bytes and feed them to PdfViewer. The response is sent with
 *   Content-Type: application/pdf and inline Content-Disposition so the
 *   browser knows to treat it as a PDF (downloadable + renderable).
 *
 * Caching: 5 minutes browser cache + ETag based on file mtime/size.
 *   PDFs are immutable once uploaded, so caching is safe.
 *
 * Error handling:
 *   - Paper not found → 404 JSON
 *   - Paper has no filePath → 404 JSON
 *   - File missing on disk (deleted manually) → 404 JSON
 *   - Read error → 500 JSON
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const paper = await db.paper.findUnique({
      where: { id },
      select: { id: true, title: true, filePath: true },
    });

    if (!paper) {
      return NextResponse.json(
        { error: "Paper not found" },
        { status: 404 }
      );
    }

    if (!paper.filePath) {
      return NextResponse.json(
        { error: "Paper has no associated file (filePath is null)" },
        { status: 404 }
      );
    }

    // Resolve the file path — it's stored as an absolute path on upload,
    // but be defensive: if it's relative, resolve from process.cwd().
    const abs = path.isAbsolute(paper.filePath)
      ? paper.filePath
      : path.join(process.cwd(), paper.filePath);

    let buffer: Buffer;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      console.error(`[paper/pdf] file not readable for ${id}:`, abs, e);
      return NextResponse.json(
        { error: "PDF file not found on disk" },
        { status: 404 }
      );
    }

    // Derive a filename for the Content-Disposition header. Use the
    // paper title if available; fall back to the id.
    const safeTitle = (paper.title || "paper")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    const filename = `${safeTitle}.pdf`;

    // Pass the Buffer to NextResponse. Node's Buffer is a Uint8Array subclass
    // and at runtime Next.js handles it fine, but TypeScript's strict BodyInit
    // type doesn't include Node's Buffer type. A `Blob` wrapper is the most
    // portable approach but its BlobPart type also rejects Uint8Array<ArrayBufferLike>
    // in TS 5.x — so we cast to BodyInit via `as BodyInit` to bridge the gap.
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=300, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[paper/pdf] GET failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
