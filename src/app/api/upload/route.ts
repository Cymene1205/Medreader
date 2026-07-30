import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { trackEvent } from "@/lib/track";
import { parsePdf } from "@/lib/pdf-parse";

export const runtime = "nodejs";
export const maxDuration = 300;

// Ensure the uploads directory exists at module load (server warm-up).
const UPLOADS_DIR = "/home/z/my-project/uploads";
try {
  mkdirSync(UPLOADS_DIR, { recursive: true });
} catch {
  // Directory creation may fail under some sandbox configurations; we'll
  // surface the error at write time if it persists.
}

export async function POST(req: NextRequest) {
  try {
    // Re-ensure the directory exists (cheap if already present).
    try {
      mkdirSync(UPLOADS_DIR, { recursive: true });
    } catch {
      // ignore
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'file' field in multipart form data" },
        { status: 400 }
      );
    }

    const originalName = file.name || "paper.pdf";
    const ext = extname(originalName).toLowerCase() || ".pdf";
    const storedName = `${randomUUID()}${ext}`;
    const storedPath = join(UPLOADS_DIR, storedName);

    // Persist file to disk.
    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    writeFileSync(storedPath, buffer);

    // Optional: associate with a logged-in user (paper may be anonymous).
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore — anonymous upload allowed
    }

    // Create the Paper record with parseStatus="pending".
    const paper = await db.paper.create({
      data: {
        title: originalName,
        filePath: storedPath,
        parseStatus: "pending",
        userId: userId ?? undefined,
      },
    });

    // Best-effort behaviour tracking. Never blocks the response.
    trackEvent(userId, "upload_pdf", originalName).catch(() => {});

    // Fire-and-forget background parsing. The response returns immediately;
    // the frontend polls GET /api/paper/[id] for status updates.
    void parsePdfBackground(paper.id, storedPath);

    return NextResponse.json(
      { paperId: paper.id, uploadUrl: storedPath },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload] failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Run the parser in the background and update the Paper record on
 * completion. Errors are swallowed (status flips to "error") so the
 * background Promise never rejects.
 */
async function parsePdfBackground(paperId: string, filePath: string): Promise<void> {
  try {
    const text = await parsePdf(filePath);
    await db.paper.update({
      where: { id: paperId },
      data: {
        parseStatus: "done",
        parsedText: text,
      },
    });
  } catch (e) {
    console.error(`[upload] background parse failed for ${paperId}:`, e);
    try {
      await db.paper.update({
        where: { id: paperId },
        data: { parseStatus: "error" },
      });
    } catch {
      // ignore DB errors during error-state update
    }
  }
}
