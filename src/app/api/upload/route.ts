import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { trackEvent } from "@/lib/track";
import { parseWithMinerU, markdownToPlainText } from "@/lib/mineru";
import { checkAndIncrement } from "@/lib/quota";

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
    mkdirSync(UPLOADS_DIR, { recursive: true });

    // Resolve the user (anonymous allowed, but quota differs by identity).
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore — anonymous upload allowed
    }

    // Quota check — MinerU is the expensive resource.
    const quota = await checkAndIncrement("mineru_parse", userId, req);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: `今日 PDF 解析额度已用尽（${quota.count}/${quota.limit}）。明日 0:00 (UTC+8) 重置。`,
          quota,
        },
        { status: 429 }
      );
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

    // Create the Paper record with parseStatus="pending".
    const paper = await db.paper.create({
      data: {
        title: originalName,
        filePath: storedPath,
        parseStatus: "pending",
        userId: userId ?? undefined,
      },
    });

    trackEvent(userId, "upload_pdf", originalName).catch(() => {});

    // Fire-and-forget background parsing using MinerU.
    // CRITICAL: must NEVER reject — attach .catch() to prevent the
    // process from being killed by an unhandled rejection.
    parsePdfBackground(paper.id, storedPath).catch((e) => {
      console.error(`[upload] background parse crashed for ${paper.id}:`, e);
      // Last-ditch effort to mark as error in DB
      db.paper
        .update({ where: { id: paper.id }, data: { parseStatus: "error" } })
        .catch(() => {});
    });

    return NextResponse.json(
      {
        paperId: paper.id,
        uploadUrl: storedPath,
        quota: { count: quota.count, limit: quota.limit },
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload] failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Run MinerU in the background, store markdown + blocks + imagesDir.
 * Falls back to pdfjs-dist only on MinerU failure (and stores plain
 * text only, no blocks).
 */
async function parsePdfBackground(paperId: string, filePath: string): Promise<void> {
  try {
    const result = await parseWithMinerU(filePath);
    await db.paper.update({
      where: { id: paperId },
      data: {
        parseStatus: "done",
        markdown: result.markdown,
        blocksJson: JSON.stringify(result.blocks),
        imagesDir: result.imagesDir,
        pageCount: result.pageCount,
        // Also store a plain-text version (for chat context redundancy)
        parsedText: markdownToPlainText(result.markdown),
      },
    });
  } catch (e) {
    console.error(`[upload] MinerU parse failed for ${paperId}:`, e);
    // Fallback: try pdfjs-dist
    try {
      const { parsePdf } = await import("@/lib/pdf-parse");
      const text = await parsePdf(filePath);
      await db.paper.update({
        where: { id: paperId },
        data: {
          parseStatus: "done",
          parsedText: text,
          // No markdown / blocks available in fallback mode
        },
      });
    } catch (e2) {
      console.error(`[upload] pdfjs fallback also failed for ${paperId}:`, e2);
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
}
