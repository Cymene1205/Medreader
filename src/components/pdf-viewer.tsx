"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  FileText,
  Loader2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  MousePointer2,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  fileData: ArrayBuffer | null;
  fileName?: string;
  onTextSelect?: (text: string) => void;
  onImageSelect?: (imageBase64: string) => void;
  /** keyword to highlight & scroll to (from outline click) */
  highlightToken?: { quote: string; keywords: string[]; nonce: number } | null;
  /** Direct page jump — when this changes (via nonce), scroll the PDF to
   *  the given page (1-indexed). Used by "跳到原图 p.N" buttons. */
  jumpToPage?: { pageIndex: number; nonce: number } | null;
};

type PageInfo = {
  pageNum: number;
  width: number;
  height: number;
  textItems: { str: string; transform: number[]; width: number; height: number }[];
};

export default function PdfViewer({
  fileData,
  fileName,
  onTextSelect,
  onImageSelect,
  highlightToken,
  jumpToPage,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement[]>([]);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1.2);
  const [mode, setMode] = useState<"text" | "image">("text");
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [libReady, setLibReady] = useState(false);
  const pdfjsLibRef = useRef<any>(null);

  // Load pdfjs-dist dynamically (client-only)
  useEffect(() => {
    let mounted = true;
    let cancelled = false;
    (async () => {
      try {
        // ── Step 1: load the pdfjs-dist library itself ──────────────────
        let lib: any;
        try {
          lib = await import("pdfjs-dist");
        } catch (importErr) {
          console.error("[pdf-viewer] import('pdfjs-dist') failed:", importErr);
          if (!cancelled) {
            setError(
              `pdfjs-dist 库加载失败：${importErr instanceof Error ? importErr.message : String(importErr)}。请检查网络或刷新页面重试。`
            );
          }
          return;
        }
        if (cancelled) return;

        // ── Step 2: locate a worker ──────────────────────────────────────
        // pdf.worker.js is an ESM module (file ends with `export{...}`).
        // Spawning it as a classic Worker via `new Worker(url)` throws
        // SyntaxError. We must spawn with `{ type: "module" }`.
        //
        // Strategy:
        //   1. Try to create a module Worker from same-origin URL
        //      (/pdf.worker.js or /api/pdf-worker). Pass it to pdf.js
        //      via GlobalWorkerOptions.workerPort — this bypasses
        //      pdf.js's own worker-spawning logic and works reliably
        //      across dev/prod/proxy setups.
        //   2. If that fails, fall back to pdf.js's workerSrc + Blob URL
        //      (let pdf.js spawn the worker itself).
        //   3. Last resort: CDN workerSrc (cdnjs). Will fail behind GFW
        //      but at least initializes.
        //   4. If everything fails, set workerSrc to "" — pdf.js falls
        //      back to fake-worker mode (main thread, slow but works).
        const sameOriginCandidates = ["/pdf.worker.js", "/api/pdf-worker"];

        let workerReady = false;

        // ── Approach A: try `new Worker(url, { type: "module" })` ──────
        // This is the most reliable way to load an ESM worker. If the URL
        // returns 404 or a non-JS body, the Worker constructor may still
        // succeed but fail at message-handshake time — so we also do a
        // HEAD-like GET first to validate the URL exists and is JS.
        for (const url of sameOriginCandidates) {
          if (workerReady) break;
          try {
            // Quick HEAD-like check (we just look at the headers).
            const probe = await fetch(url, { method: "GET", cache: "no-store" });
            if (!probe.ok) {
              console.warn(`[pdf-viewer] worker candidate ${url} HTTP ${probe.status}`);
              // Drain to free the connection.
              try { await probe.arrayBuffer(); } catch {}
              continue;
            }
            const ct = probe.headers.get("content-type") || "";
            const len = Number(probe.headers.get("content-length") || "0");
            // Drain to free the connection.
            try { await probe.arrayBuffer(); } catch {}
            if (len < 100_000) {
              console.warn(`[pdf-viewer] worker candidate ${url} too small (${len}b)`);
              continue;
            }
            if (!(ct.includes("javascript") || ct.includes("ecmascript") || ct === "")) {
              console.warn(`[pdf-viewer] worker candidate ${url} wrong content-type: ${ct}`);
              continue;
            }

            // Try to spawn a module worker.
            // This may throw:
            //   - SyntaxError if the script isn't valid ESM
            //   - SecurityError if cross-origin without CORS
            //   - NetworkError if the URL is unreachable
            // We catch and fall through to the next candidate.
            try {
              const worker = new Worker(url, { type: "module" });
              // Verify the worker is alive by sending a ping. pdf.js's
              // worker will respond to "ready" but we can't easily test
              // that without pdf.js. Instead we just trust the
              // constructor succeeded.
              lib.GlobalWorkerOptions.workerPort = worker;
              workerReady = true;
              console.log(`[pdf-viewer] worker ready via module Worker from ${url} (${len}b)`);
              break;
            } catch (spawnErr) {
              console.warn(`[pdf-viewer] new Worker(${url}, {type:module}) failed:`, spawnErr);
            }
          } catch (probeErr) {
            console.warn(`[pdf-viewer] probe ${url} failed:`, probeErr);
          }
        }

        // ── Approach B: pdf.js workerSrc + Blob URL with polyfill ────
        // Fetch the worker text, PREPEND the polyfill code (so the
        // Worker thread also gets Math.sumPrecise / Map.getOrInsertComputed
        // etc. — these don't transfer from the main thread), wrap in a
        // Blob, hand the Blob URL to pdf.js.
        //
        // Why prepend: pdfjs v6 calls Math.sumPrecise inside the Worker
        // thread, but the Worker has its own global scope. Main-thread
        // polyfills don't apply. We must inject the polyfill into the
        // worker source itself.
        if (!workerReady) {
          for (const url of sameOriginCandidates) {
            if (workerReady) break;
            try {
              const res = await fetch(url, { cache: "no-store" });
              if (!res.ok) continue;
              const text = await res.text();
              if (text.length < 100_000) continue;

              // Fetch the polyfill source (synchronously loaded by
              // <script src="/polyfills.js"> in <head>). We re-fetch it
              // here as text so we can prepend it to the worker source.
              let polyfillSource = "";
              try {
                const pfRes = await fetch("/polyfills.js", { cache: "no-store" });
                if (pfRes.ok) {
                  polyfillSource = await pfRes.text();
                }
              } catch (pfErr) {
                console.warn("[pdf-viewer] polyfill fetch for worker failed:", pfErr);
              }

              const combined =
                polyfillSource +
                "\n;\n// ─── worker code below ───\n" +
                text;
              const blob = new Blob([combined], { type: "application/javascript" });
              lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
              workerReady = true;
              console.log(
                `[pdf-viewer] worker ready via Blob URL from ${url} (${text.length}b worker + ${polyfillSource.length}b polyfill)`
              );
              break;
            } catch (blobErr) {
              console.warn(`[pdf-viewer] Blob URL from ${url} failed:`, blobErr);
            }
          }
        }

        // ── Approach C: CDN workerSrc ──────────────────────────────────
        if (!workerReady) {
          try {
            const cdnUrl = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`;
            lib.GlobalWorkerOptions.workerSrc = cdnUrl;
            workerReady = true;
            console.warn(`[pdf-viewer] falling back to CDN worker: ${cdnUrl}`);
          } catch (cdnErr) {
            console.warn("[pdf-viewer] CDN worker setup failed:", cdnErr);
          }
        }

        // ── Approach D: import worker code into main thread ───────────
        // This is the ultimate fallback. We dynamically import the
        // worker module directly into the main bundle. The worker code
        // sets `globalThis.pdfjsWorker = { WorkerMessageHandler }` as a
        // side-effect, and pdf.js detects this and runs in "fake worker"
        // mode — all parsing happens on the main thread (slower but
        // guaranteed to work, no spawn / no network / no CORS).
        //
        // We do NOT set workerSrc at all in this mode; pdf.js v6+
        // detects `globalThis.pdfjsWorker` is set and skips worker
        // spawning entirely.
        if (!workerReady) {
          try {
            await import("pdfjs-dist/build/pdf.worker.min.mjs");
            workerReady = true;
            console.warn(
              "[pdf-viewer] all worker sources failed — loaded pdf.worker.min.mjs into main thread (fake worker mode, slower but works)"
            );
          } catch (importErr) {
            console.error("[pdf-viewer] main-thread worker import failed:", importErr);
            // Truly last resort: just clear workerSrc and hope pdf.js
            // can figure it out.
            try {
              lib.GlobalWorkerOptions.workerSrc = "";
            } catch {
              // ignore
            }
          }
        }

        if (mounted && !cancelled) {
          pdfjsLibRef.current = lib;
          setLibReady(true);
        }
      } catch (e) {
        console.error("[pdf-viewer] init crashed unexpectedly:", e);
        if (!cancelled) {
          setError(
            `PDF 渲染初始化失败：${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    })();
    return () => {
      mounted = false;
      cancelled = true;
    };
  }, []);

  // Load PDF document
  useEffect(() => {
    if (!fileData || !libReady || !pdfjsLibRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);

    (async () => {
      try {
        const lib = pdfjsLibRef.current;
        // CRITICAL: pdfjs's getDocument() TRANSFERS ownership of the
        // ArrayBuffer (detaches it). If we pass the original `fileData`
        // and the component later re-mounts (e.g. user switches tabs and
        // comes back), the second call would see a detached buffer and
        // fail with "Cannot perform construct on a detached ArrayBuffer".
        //
        // Fix: always slice(0) to create a fresh copy each time. The cost
        // is one buffer copy per load (~1-3ms for a typical PDF), which
        // is negligible compared to the actual parse cost.
        const buf = fileData.slice(0);
        const loadingTask = lib.getDocument({
          data: new Uint8Array(buf),
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);

        // Pre-extract text content per page (for outline keyword search)
        const infos: PageInfo[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const tc = await page.getTextContent();
          infos.push({
            pageNum: i,
            width: viewport.width,
            height: viewport.height,
            textItems: tc.items
              .filter((it: any) => typeof it.str === "string" && it.str.length > 0)
              .map((it: any) => ({
                str: it.str,
                transform: it.transform,
                width: it.width,
                height: it.height,
              })),
          });
          page.cleanup();
        }
        if (cancelled) return;
        setPages(infos);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileData, libReady]);

  // Render pages when doc / scale changes
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    (async () => {
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (cancelled) return;
        const pageDiv = pagesRef.current[i - 1];
        if (!pageDiv) continue;
        await renderPage(pdfDoc, i, pageDiv, scale, pdfjsLibRef.current, mode);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, scale, mode]);

  // Handle highlight token (jump + flash)
  useEffect(() => {
    if (!highlightToken || pages.length === 0) return;
    const { quote, keywords } = highlightToken;
    // Find page containing the quote or any keyword
    let targetPage = -1;
    let matchText = quote;
    for (const p of pages) {
      const full = p.textItems.map((t) => t.str).join(" ");
      if (quote && quote.length > 4 && full.includes(quote)) {
        targetPage = p.pageNum;
        matchText = quote;
        break;
      }
      for (const kw of keywords) {
        if (kw && kw.length > 1 && full.toLowerCase().includes(kw.toLowerCase())) {
          targetPage = p.pageNum;
          matchText = kw;
          break;
        }
      }
      if (targetPage !== -1) break;
    }
    if (targetPage === -1) {
      // fallback: try first keyword in any page
      const kw = keywords.find((k) => k && k.length > 1);
      if (kw) {
        for (const p of pages) {
          const full = p.textItems.map((t) => t.str).join(" ");
          if (full.toLowerCase().includes(kw.toLowerCase())) {
            targetPage = p.pageNum;
            matchText = kw;
            break;
          }
        }
      }
    }
    if (targetPage !== -1) {
      const pageDiv = pagesRef.current[targetPage - 1];
      if (pageDiv) {
        pageDiv.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash highlight
        pageDiv.classList.add("page-flash");
        setTimeout(() => pageDiv.classList.remove("page-flash"), 1800);
        // Try to highlight text spans containing the keyword
        const spans = pageDiv.querySelectorAll<HTMLElement>("span.pdf-text-span");
        spans.forEach((sp) => {
          const t = sp.textContent || "";
          if (
            matchText &&
            t.toLowerCase().includes(matchText.toLowerCase().slice(0, 8))
          ) {
            sp.classList.add("pdf-text-flash");
            setTimeout(() => sp.classList.remove("pdf-text-flash"), 2400);
          }
        });
      }
    }
  }, [highlightToken, pages]);

  // Direct page jump — for "跳到原图 p.N" button on figure cards.
  // Scrolls the target page into view + flashes it. Doesn't need text matching
  // because we already know the page number.
  useEffect(() => {
    if (!jumpToPage || pages.length === 0) return;
    const target = jumpToPage.pageIndex;
    if (target < 1 || target > pages.length) return;
    const pageDiv = pagesRef.current[target - 1];
    if (pageDiv) {
      pageDiv.scrollIntoView({ behavior: "smooth", block: "center" });
      pageDiv.classList.add("page-flash");
      setTimeout(() => pageDiv.classList.remove("page-flash"), 1800);
    }
  }, [jumpToPage, pages]);

  // Text selection listener
  useEffect(() => {
    if (mode !== "text") return;
    const handler = () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0) {
        onTextSelect?.(sel.toString().trim());
      }
    };
    document.addEventListener("mouseup", handler);
    return () => document.removeEventListener("mouseup", handler);
  }, [mode, onTextSelect]);

  const zoomIn = () => setScale((s) => Math.min(s + 0.2, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.2, 0.5));

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-background/80 backdrop-blur-sm">
        <span className="text-xs text-muted-foreground mr-2 max-w-[200px] truncate" title={fileName}>
          {fileName || "未选择文件"}
        </span>
        <div className="flex-1" />
        <Button
          variant={mode === "text" ? "default" : "ghost"}
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setMode("text")}
          title="文本选择模式"
        >
          <MousePointer2 className="h-3.5 w-3.5" />
          文本
        </Button>
        <Button
          variant={mode === "image" ? "default" : "ghost"}
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => setMode("image")}
          title="图片框选模式：在 PDF 上左键拖拽选择图片区域"
        >
          <Square className="h-3.5 w-3.5" />
          框选
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={zoomOut}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-10 text-center">
          {Math.round(scale * 100)}%
        </span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={zoomIn}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Mode hint */}
      {mode === "image" && fileData && (
        <div className="px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          框选模式：在 PDF 页面上按住左键拖拽选择图片区域，松开后图片将自动添加到提问框
        </div>
      )}

      {/* PDF area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex flex-col items-center gap-4"
      >
        {!fileData && (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 py-20">
            <FileText className="h-10 w-10 opacity-40" />
            <p className="text-sm">点击上方按钮导入 PDF 文献</p>
            <p className="text-xs text-muted-foreground/70">
              支持 PDF 格式；导入后将自动生成 6 维度层次化大纲
            </p>
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在解析 PDF…
          </div>
        )}
        {error && (
          <div className="py-8 px-4 max-w-[600px] mx-auto">
            <div className="text-sm text-red-500 font-medium mb-2">
              PDF 渲染失败
            </div>
            <div className="text-xs text-muted-foreground mb-3 leading-relaxed">
              {error}
            </div>
            <div className="text-[11px] text-muted-foreground/80 leading-relaxed bg-muted/40 rounded px-3 py-2 border border-border/40">
              <strong className="text-foreground">可能的解决方法：</strong>
              <br />· 刷新页面后重新上传 PDF（worker 文件可能加载失败）
              <br />· 检查网络是否能访问同源 <code className="text-[10px] bg-muted px-1 rounded">/api/pdf-worker</code> 路径
              <br />· 如错误信息含 <code className="text-[10px] bg-muted px-1 rounded">toHex</code>，说明 PDF worker 版本与 pdfjs-dist 不匹配，需重新构建（<code className="text-[10px] bg-muted px-1 rounded">npm run build</code>）
            </div>
          </div>
        )}
        {pdfDoc &&
          Array.from({ length: numPages }).map((_, i) => (
            <div
              key={i}
              ref={(el) => {
                if (el) pagesRef.current[i] = el;
              }}
              data-page={i + 1}
              className="pdf-page relative bg-white shadow-md"
              style={{ border: "1px solid rgba(0,0,0,0.06)" }}
            >
              <canvas className="block" />
              <div className="pdf-text-layer absolute inset-0" />
              {mode === "image" && (
                <ImageSelectOverlay
                  pageNumber={i + 1}
                  pdfDoc={pdfDoc}
                  scale={scale}
                  onCapture={(b64) => onImageSelect?.(b64)}
                />
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------- helpers ----------

async function renderPage(
  doc: any,
  pageNum: number,
  pageDiv: HTMLDivElement,
  scale: number,
  lib: any,
  mode: "text" | "image"
) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = pageDiv.querySelector("canvas") as HTMLCanvasElement;
  const textLayer = pageDiv.querySelector(".pdf-text-layer") as HTMLDivElement;

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  pageDiv.style.width = `${Math.floor(viewport.width)}px`;
  pageDiv.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  await page.render({
    canvasContext: ctx,
    viewport,
    canvas,
  }).promise;

  // Build text layer
  textLayer.innerHTML = "";
  textLayer.style.width = `${Math.floor(viewport.width)}px`;
  textLayer.style.height = `${Math.floor(viewport.height)}px`;
  if (mode === "text") {
    const textContent = await page.getTextContent();
    // Build using TextLayer class (pdfjs v6)
    try {
      const tl = new lib.TextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
      });
      await tl.render();
    } catch {
      // fallback: legacy renderTextLayer
      try {
        await lib.renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
          textDivs: [],
        }).promise;
      } catch {
        // ignore
      }
    }
    // Mark spans for flash
    textLayer
      .querySelectorAll("span")
      .forEach((sp) => sp.classList.add("pdf-text-span"));
  }
  page.cleanup();
}

// ---------- Image select overlay ----------
function ImageSelectOverlay({
  pageNumber,
  pdfDoc,
  scale,
  onCapture,
}: {
  pageNumber: number;
  pdfDoc: any;
  scale: number;
  onCapture: (b64: string) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!overlayRef.current) return;
    const bounds = overlayRef.current.getBoundingClientRect();
    startRef.current = {
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top,
    };
    setDragging(true);
    setRect({ x: startRef.current.x, y: startRef.current.y, w: 0, h: 0 });
    e.preventDefault();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !startRef.current || !overlayRef.current) return;
    const bounds = overlayRef.current.getBoundingClientRect();
    const cx = e.clientX - bounds.left;
    const cy = e.clientY - bounds.top;
    const x = Math.min(startRef.current.x, cx);
    const y = Math.min(startRef.current.y, cy);
    const w = Math.abs(cx - startRef.current.x);
    const h = Math.abs(cy - startRef.current.y);
    setRect({ x, y, w, h });
  };

  const onMouseUp = useCallback(async () => {
    if (!dragging || !rect || !overlayRef.current) {
      setDragging(false);
      return;
    }
    setDragging(false);
    if (rect.w < 10 || rect.h < 10) {
      setRect(null);
      return;
    }

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      // Render full page to offscreen canvas at devicePixelRatio.
      //
      // CRITICAL: We must set the ctx transform to `ratio` so the PDF
      // (which renders in logical units of viewport.width ×
      // viewport.height) gets scaled up to fill the full physical
      // canvas (viewport.width * ratio × viewport.height * ratio).
      // Without this transform, the rendered content would only fill
      // the top-left corner of the canvas at 1/ratio scale, and the
      // subsequent crop (which uses ratio-scaled coordinates) would
      // extract mostly blank pixels OR — when the crop region extends
      // past the actually-rendered area — fall back to grabbing the
      // entire visible page from the main canvas instead.
      const ratio = window.devicePixelRatio || 1;
      const off = document.createElement("canvas");
      off.width = Math.floor(viewport.width * ratio);
      off.height = Math.floor(viewport.height * ratio);
      const offCtx = off.getContext("2d")!;
      offCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      await page.render({
        canvasContext: offCtx,
        viewport,
        canvas: off,
      }).promise;

      // Crop the rectangle. rect.x/y/w/h are in CSS pixels relative to
      // the overlay (which is inset-0 on pageDiv), so they match the
      // PDF viewport's logical coordinate system. Multiply by ratio
      // to get physical-pixel offsets into the offscreen canvas.
      const sx = Math.max(0, Math.floor(rect.x * ratio));
      const sy = Math.max(0, Math.floor(rect.y * ratio));
      const sw = Math.min(off.width - sx, Math.floor(rect.w * ratio));
      const sh = Math.min(off.height - sy, Math.floor(rect.h * ratio));
      if (sw < 4 || sh < 4) {
        setRect(null);
        return;
      }
      const out = document.createElement("canvas");
      out.width = sw;
      out.height = sh;
      const outCtx = out.getContext("2d")!;
      // Reset transform on the output canvas so drawImage uses raw
      // physical pixel coordinates (otherwise the ratio transform
      // would scale the source image down incorrectly).
      outCtx.setTransform(1, 0, 0, 1, 0, 0);
      outCtx.drawImage(off, sx, sy, sw, sh, 0, 0, sw, sh);
      const b64 = out.toDataURL("image/png");
      onCapture(b64);
    } catch (e) {
      console.error("image capture error", e);
    } finally {
      setRect(null);
    }
  }, [dragging, rect, pdfDoc, pageNumber, scale, onCapture]);

  useEffect(() => {
    if (!dragging) return;
    const up = () => {
      onMouseUp();
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging, onMouseUp]);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 cursor-crosshair"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
    >
      {rect && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-500/15 pointer-events-none"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
          }}
        />
      )}
    </div>
  );
}
