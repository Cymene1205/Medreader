import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, writeFileSync } from "fs";
import { join, extname } from "path";
import { randomUUID, createHmac } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { trackEvent } from "@/lib/track";
import { parseWithMinerU, markdownToPlainText } from "@/lib/mineru";
import { checkAndIncrement } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 300;

// 50 MB hard cap — matches `experimental.serverActions.bodySizeLimit`
// in next.config.ts and the client-side check in app/page.tsx.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// Ensure the uploads directory exists at module load (server warm-up).
// Path is configurable via UPLOADS_DIR env var so the same code runs in
// dev (sandbox) and Docker (container with mounted volume).
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/home/z/my-project/uploads";
try {
  mkdirSync(UPLOADS_DIR, { recursive: true });
} catch {
  // Directory creation may fail under some sandbox configurations; we'll
  // surface the error at write time if it persists.
}

export async function POST(req: NextRequest) {
  try {
    mkdirSync(UPLOADS_DIR, { recursive: true });

    // Authentication required — anonymous upload is no longer allowed
    // (production hardening, see fix #1 in the production fix pack).
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id ?? null;
    const userRole = (session?.user as any)?.role ?? null;
    if (!userId) {
      return NextResponse.json(
        { error: "请先登录后再上传 PDF", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    // Quota check — MinerU is the expensive resource.
    // Admins bypass the counter entirely (see roleBypassesQuota in src/lib/quota.ts).
    const quota = await checkAndIncrement("mineru_parse", userId, req, userRole);
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

    // Size check — 50 MB hard cap.
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单文件上限 50 MB。请拆分或压缩后上传。`,
          code: "FILE_TOO_LARGE",
        },
        { status: 413 }
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
        userId: userId,
      },
    });

    trackEvent(userId, "upload_pdf", originalName).catch(() => {});

    // Generate a signed public URL that MinerU can fetch anonymously.
    //
    // The PDF route (/api/paper/[id]/pdf) serves the file, but normally
    // requires a session cookie. We generate an HMAC-signed token using
    // NEXTAUTH_SECRET and pass it as ?token=<paperId>.<hmac>. The PDF
    // route verifies this token in constant time and serves the file
    // without auth.
    //
    // The public base URL is read from NEXTAUTH_URL (which must be set
    // to the externally reachable URL, e.g. http://1.2.3.4:3000).
    const publicBaseUrl = (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
    if (!publicBaseUrl) {
      // Can't generate a public URL — MinerU can't pull the PDF.
      // Fail fast so the user sees a clear error instead of a 15-min hang.
      await db.paper.update({
        where: { id: paper.id },
        data: { parseStatus: "error" },
      }).catch(() => {});
      return NextResponse.json(
        {
          error:
            "Server misconfigured: NEXTAUTH_URL is not set. MinerU URL-pull mode requires a public base URL.",
          code: "NEXTAUTH_URL_MISSING",
        },
        { status: 500 }
      );
    }
    const pullToken = signPullToken(paper.id);
    const pdfPublicUrl = `${publicBaseUrl}/api/paper/${paper.id}/pdf?token=${pullToken}`;
    console.log(`[upload] generated pull URL for paper ${paper.id}: ${publicBaseUrl}/api/paper/${paper.id}/pdf?token=${pullToken.slice(0, paper.id.length + 4)}...`);

    // Fire-and-forget background parsing using MinerU.
    // CRITICAL: must NEVER reject — attach .catch() to prevent the
    // process from being killed by an unhandled rejection.
    parsePdfBackground(paper.id, storedPath, pdfPublicUrl).catch((e) => {
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
 * Generate a pull token: <paperId>.<hex-hmac-sha256(paperId, NEXTAUTH_SECRET)>
 *
 * Verified by /api/paper/[id]/pdf/route.ts via verifyPullToken.
 */
function signPullToken(paperId: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not set — cannot sign pull token");
  }
  const hmac = createHmac("sha256", secret).update(paperId).digest("hex");
  return `${paperId}.${hmac}`;
}

/**
 * Run MinerU in the background, store markdown + blocks + imagesDir.
 * Falls back to pdfjs-dist only on MinerU failure (and stores plain
 * text only, no blocks).
 *
 * In URL-pull mode (new), `pdfPublicUrl` is the signed public URL
 * MinerU will fetch. We pass it straight through to parseWithMinerU.
 */
async function parsePdfBackground(
  paperId: string,
  filePath: string,
  pdfPublicUrl: string
): Promise<void> {
  try {
    const result = await parseWithMinerU(filePath, pdfPublicUrl);

    // Extract figures + citations BEFORE marking the paper as "done".
    let figCount = 0;
    try {
      const { extractAndStoreFigures } = await import("@/lib/extract-figures");
      figCount = await extractAndStoreFigures(paperId, result.blocks, result.imagesDir);
      console.log(`[upload] extracted ${figCount} figures for paper ${paperId}`);
    } catch (e) {
      console.warn(`[upload] extractAndStoreFigures failed (non-fatal) for ${paperId}:`, e);
    }
    try {
      const { buildCitationsAndStore } = await import("@/lib/align-citations");
      const cites = await buildCitationsAndStore(paperId);
      console.log(`[upload] stored ${cites.length} citations for paper ${paperId}`);
    } catch (e) {
      console.warn(`[upload] buildCitationsAndStore failed (non-fatal) for ${paperId}:`, e);
    }

    // Now flip parseStatus to "done".
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
        },
      });
      try {
        const { buildCitationsAndStore } = await import("@/lib/align-citations");
        const cites = await buildCitationsAndStore(paperId);
        console.log(`[upload] (fallback) stored ${cites.length} citations for paper ${paperId}`);
      } catch (e2) {
        console.warn(`[upload] (fallback) buildCitationsAndStore failed for ${paperId}:`, e2);
      }
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
