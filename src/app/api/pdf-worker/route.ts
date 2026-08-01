import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/**
 * GET /api/pdf-worker
 *
 * Serves the pdf.js worker script as a same-origin JavaScript response.
 *
 * Why this exists:
 *   pdf.js needs a Web Worker to parse PDFs. The standard pattern is to
 *   set `pdfjsLib.GlobalWorkerOptions.workerSrc = "<url>"` and pdf.js will
 *   spawn a Worker that loads that URL.
 *
 *   We used to point workerSrc at the cdnjs.cloudflare.com CDN — but that
 *   fails for users behind GFW / corporate firewalls / offline networks,
 *   causing "PDF 渲染无法进行" for everyone except the developer.
 *
 *   We tried placing the worker file in /public/pdf.worker.js — but Next.js
 *   16 standalone server returns 404 for that path (likely because .js files
 *   in /public are matched against app-router before static serving).
 *
 *   We tried `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`
 *   — webpack emits the worker to `/_next/static/media/pdf.worker.min.<hash>.mjs`,
 *   but the standalone server ALSO returns 404 for `.mjs` files in /static/media
 *   (only `.woff2` / `.svg` / `.png` etc. work — `.mjs` is intercepted by the
 *   app-router before static serving).
 *
 *   So: we serve the worker through this API route. The file is copied into
 *   `.next/standalone/public/pdf.worker.js` at build time, and the API route
 *   reads it from disk on each request (cached by the browser for 24h via
 *   Cache-Control). This is the most reliable way to get a same-origin
 *   worker URL in Next.js 16 standalone mode.
 *
 * Client usage:
 *   const res = await fetch('/api/pdf-worker');
 *   const text = await res.text();
 *   const blob = new Blob([text], { type: 'application/javascript' });
 *   pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
 */
export const runtime = "nodejs";
// Note: deliberately NOT `export const dynamic = "force-static"` — testing
// showed that force-static caused Next.js 16 standalone to 404 the route.
// Leaving it as a regular dynamic route works correctly.

export async function GET() {
  try {
    // Resolve worker file path. In standalone mode, process.cwd() is
    // `.next/standalone/`, so `public/pdf.worker.js` resolves to
    // `.next/standalone/public/pdf.worker.js` (copied by build script).
    // In dev mode, process.cwd() is the project root, so the same relative
    // path resolves to `<project>/public/pdf.worker.js`.
    const workerPath = path.join(process.cwd(), "public", "pdf.worker.js");
    const content = await readFile(workerPath, "utf-8");
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/pdf-worker] failed to read worker file:", msg);
    return new NextResponse(`// Failed to load PDF worker: ${msg}`, {
      status: 500,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }
}
