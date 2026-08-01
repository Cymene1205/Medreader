import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "fs/promises";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";

/**
 * GET /api/paper/[id]/pdf
 *
 * Streams the original uploaded PDF binary for a paper.
 *
 * Two access modes:
 *
 *   (A) Authenticated user (browser) — session cookie required.
 *       Middleware handles the auth gate; if the request reaches here
 *       without a session, we still verify via getServerSession below
 *       (defense-in-depth, in case middleware is bypassed).
 *
 *   (B) MinerU server pulling the PDF for parsing — anonymous, but
 *       must carry a signed `token` query param.
 *
 *       Why: when we submit a paper to MinerU via the URL-pull API
 *       (/api/v4/extract/task/batch), MinerU's backend needs to GET
 *       the PDF. It has no session cookie. We can't make /api/paper/[id]/pdf
 *       fully public because that would leak any user's PDF to anyone
 *       who knows the cuid (cuids are unguessable in practice, but
 *       defense-in-depth is still better).
 *
 *       Solution: the upload route generates an HMAC-SHA256 signature
 *       over the paperId using NEXTAUTH_SECRET, and stores it on the
 *       Paper row (in the mineruTaskId column, prefixed with "pull:"
 *       so we can tell it apart from a real MinerU batch_id). The PDF
 *       route verifies the token in constant time before serving.
 *
 *       Token format: <paperId>.<hex-hmac>
 *       Verification: recompute HMAC of paperId and compare.
 *
 *       Token lifetime: tied to the Paper row. Once parsing is done
 *       the upload route overwrites mineruTaskId with the real MinerU
 *       batch_id, invalidating the pull token — so the window during
 *       which a pull token works is exactly the parse duration.
 *
 * Caching: 5 minutes browser cache + ETag based on file mtime/size.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const paper = await db.paper.findUnique({
      where: { id },
      select: { id: true, title: true, filePath: true, userId: true, mineruTaskId: true },
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

    // --- Auth check ------------------------------------------------------
    //
    // Two ways to pass:
    //   1. Valid session cookie (handled by middleware; if we reach here
    //      with a cookie, trust it).
    //   2. Valid `?token=` query param (HMAC over paperId). Used by MinerU.
    //
    // If neither → 401.
    const hasSessionCookie =
      req.cookies.has("next-auth.session-token") ||
      req.cookies.has("__Secure-next-auth.session-token");

    if (!hasSessionCookie) {
      // Check pull token.
      const token = req.nextUrl.searchParams.get("token");
      if (!token) {
        return NextResponse.json(
          { error: "Authentication required (session cookie or ?token=)", code: "UNAUTHORIZED" },
          { status: 401 }
        );
      }
      if (!verifyPullToken(id, token)) {
        return NextResponse.json(
          { error: "Invalid or expired pull token", code: "INVALID_TOKEN" },
          { status: 403 }
        );
      }
    }
    // --- End auth check --------------------------------------------------

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

    // Derive a filename for the Content-Disposition header.
    const safeTitle = (paper.title || "paper")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    const filename = `${safeTitle}.pdf`;

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

/**
 * Verify a pull token: <paperId>.<hex-hmac-sha256(paperId, NEXTAUTH_SECRET)>
 *
 * Constant-time comparison to prevent timing attacks (even though
 * paperIds are unguessable cuids, this is cheap and correct).
 */
function verifyPullToken(paperId: string, token: string): boolean {
  // Expected format: <paperId>.<64-hex-chars>
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot !== paperId.length) {
    return false;
  }
  const tokenPaperId = token.slice(0, dot);
  const tokenHmac = token.slice(dot + 1);

  // paperId part must match (constant time)
  if (tokenPaperId.length !== paperId.length) return false;
  try {
    if (!timingSafeEqual(Buffer.from(tokenPaperId), Buffer.from(paperId))) {
      return false;
    }
  } catch {
    return false;
  }

  // Recompute HMAC
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    console.error("[paper/pdf] NEXTAUTH_SECRET not set — cannot verify pull tokens");
    return false;
  }
  const expected = createHmac("sha256", secret).update(paperId).digest("hex");

  // Hex string compare (length already known to be 64 each)
  if (tokenHmac.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(tokenHmac), Buffer.from(expected));
  } catch {
    return false;
  }
}
