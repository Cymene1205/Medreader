import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join, basename, extname, resolve, relative, isAbsolute } from "path";

export const runtime = "nodejs";

/**
 * GET /api/paper-images?dir=<absolute path>&name=<filename>
 *
 * Serves an image extracted by MinerU to disk. The `dir` parameter is
 * the absolute path stored in Paper.imagesDir; we validate it lives
 * under the configured uploads root to prevent directory traversal.
 *
 * The uploads root is configurable via UPLOADS_DIR env var so this
 * route works in dev (sandbox /home/z/my-project/uploads) and Docker
 * (container /app/uploads) alike.
 *
 * Security:
 *   - `dir` must resolve to a path UNDER ALLOWED_ROOT (no siblings,
 *     no `..` traversal). `path.relative` is the correct primitive:
 *     if `relative(ALLOWED_ROOT, resolved)` starts with `..` or is
 *     absolute (drive letter on Windows), the path is outside.
 *     A naive `startsWith` check is bypassable by sibling dirs
 *     like `/home/z/my-project/uploads-evil`.
 */
const ALLOWED_ROOT = resolve(process.env.UPLOADS_DIR || "/home/z/my-project/uploads");

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dir = url.searchParams.get("dir") || "";
  const name = url.searchParams.get("name") || "";

  if (!dir || !name) {
    return NextResponse.json({ error: "dir and name required" }, { status: 400 });
  }

  // Resolve the dir to an absolute, normalized path. `resolve` handles
  // `..`, `./`, and trailing slashes.
  const resolvedDir = resolve(dir);

  // `path.relative` returns:
  //   - "" if resolvedDir === ALLOWED_ROOT
  //   - "subdir/..." if resolvedDir is inside ALLOWED_ROOT
  //   - "../..." if resolvedDir is outside ALLOWED_ROOT
  //   - absolute path on Windows if on a different drive
  const rel = relative(ALLOWED_ROOT, resolvedDir);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return NextResponse.json({ error: "Forbidden dir" }, { status: 403 });
  }

  // `basename` strips any directory components from `name`, so the
  // client can't escape via `name=../../etc/passwd`.
  const safeName = basename(name);
  if (!safeName || safeName === "." || safeName === "..") {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const fullPath = join(resolvedDir, safeName);

  // Belt-and-braces: re-validate the final path too, in case `join`
  // somehow produced something unexpected (it shouldn't, but cheap to check).
  const finalRel = relative(ALLOWED_ROOT, fullPath);
  if (finalRel.startsWith("..") || isAbsolute(finalRel)) {
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

    return new NextResponse(new Uint8Array(buf), {
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
