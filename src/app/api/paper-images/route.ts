import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, basename, extname } from "path";

export const runtime = "nodejs";

/**
 * GET /api/paper-images?dir=<absolute path>&name=<filename>
 *
 * Serves an image extracted by MinerU to disk. The `dir` parameter is
 * the absolute path stored in Paper.imagesDir; we validate it lives
 * under /home/z/my-project/uploads/ to prevent directory traversal.
 */
const ALLOWED_ROOT = "/home/z/my-project/uploads";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dir = url.searchParams.get("dir") || "";
  const name = url.searchParams.get("name") || "";

  if (!dir || !name) {
    return NextResponse.json({ error: "dir and name required" }, { status: 400 });
  }

  const normalizedDir = dir.replace(/\/+$/, "");
  if (!normalizedDir.startsWith(ALLOWED_ROOT)) {
    return NextResponse.json({ error: "Forbidden dir" }, { status: 403 });
  }

  const safeName = basename(name);
  if (!safeName || safeName.includes("..")) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const fullPath = join(normalizedDir, safeName);
  if (!fullPath.startsWith(ALLOWED_ROOT)) {
    return NextResponse.json({ error: "Forbidden path" }, { status: 403 });
  }

  try {
    const buf = await readFile(fullPath);
    const ext = extname(safeName).toLowerCase();
    const mime =
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".gif" ? "image/gif" :
      ext === ".webp" ? "image/webp" :
      "application/octet-stream";

    return new NextResponse(buf as any, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "read failed" },
      { status: 404 }
    );
  }
}
