"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useSession, signOut } from "next-auth/react";
import PdfViewer from "@/components/pdf-viewer";
import OutlinePanel, {
  type Outline,
  type OutlineChild,
  type OutlineSection,
} from "@/components/outline-panel";
import type { Figure, Citation } from "@/components/figure-chain";
import TranslationPanel from "@/components/translation-panel";
import ChatPanel from "@/components/chat-panel";
import MindmapView from "@/components/mindmap-view";
import BlockReader, { type MinerUBlock, type BlockReaderHandle } from "@/components/block-reader";
import LLMSettingsDialog, {
  refreshLLMHeaders,
  hasUserLLMConfig,
} from "@/components/llm-settings-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  Upload,
  Loader2,
  BookOpen,
  Info,
  LogOut,
  LogIn,
  Shield,
  FileText,
  Network,
  LayoutGrid,
  Settings2,
  AlertTriangle,
  X,
  Download,
  ChevronDown,
  FileCode2,
  Share2,
  Check,
} from "lucide-react";
import Link from "next/link";
import { exportAnalysisMarkdown, exportMindmapHtml } from "@/lib/export-utils";

type HighlightToken = {
  quote: string;
  keywords: string[];
  nonce: number;
};

type UploadStage = "idle" | "uploading" | "parsing" | "analyzing" | "done";

export default function Home() {
  const { data: session, status } = useSession();

  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [paperText, setPaperText] = useState<string>("");
  const [paperMarkdown, setPaperMarkdown] = useState<string | null>(null);
  const [paperBlocks, setPaperBlocks] = useState<MinerUBlock[] | null>(null);
  const [paperImagesDir, setPaperImagesDir] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);

  const [outline, setOutline] = useState<Outline | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [mineruStatus, setMineruStatus] = useState<string>("");

  const [selectedText, setSelectedText] = useState<string>("");
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
  const [selectionNonce, setSelectionNonce] = useState(0);

  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [highlightToken, setHighlightToken] = useState<HighlightToken | null>(null);
  // Direct page jump signal for PdfViewer — fires when user clicks
  // "跳到原图 p.N" on a figure card. Nonce makes the same page re-jumpable.
  const [jumpToPage, setJumpToPage] = useState<{ pageIndex: number; nonce: number } | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | undefined>();
  const [activeView, setActiveView] = useState<"blocks" | "pdf" | "mindmap">("pdf");

  // New 4-layer pipeline state: figures + citations + spine polling
  const [figures, setFigures] = useState<Figure[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [figuresLoading, setFiguresLoading] = useState(false);
  /**
   * Stage 2 progress state machine — drives the progress indicator inside
   * OutlinePanel's 论证主线 card.
   *
   * Lifecycle:
   *   idle      → (paper uploaded, MinerU figure extraction done)
   *   extracting→ (Call A POST fired, waiting for first figures poll)
   *   call-a    → (figures exist but at least one has no `question` yet)
   *   spine     → (all figures have questions, argumentSpine still null)
   *   done      → (argumentSpine present)
   *   error     → (Call A POST returned non-2xx, or polling exhausted)
   */
  const [figuresStatus, setFiguresStatus] = useState<
    "idle" | "extracting" | "call-a" | "spine" | "done" | "error"
  >("idle");
  // Tracks whether the user has manually clicked a center-tab since the
  // current upload. We use this to decide whether to auto-switch from the
  // PDF tab (the default initial view, shown while MinerU is parsing) to
  // the 智能解析 tab once the parsed markdown/blocks are ready. If the user
  // has already chosen a tab themselves, we leave them alone.
  //
  // Implemented as a ref rather than state because the long-running
  // `onFile` callback (which has empty deps `[]`) needs to read the CURRENT
  // value at the moment MinerU finishes — a state value captured in the
  // closure would be stuck at `false` from the first render.
  const userTouchedTabRef = useRef(false);
  const markTabTouched = useCallback(() => {
    userTouchedTabRef.current = true;
  }, []);
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  // Tracks whether the user has dismissed the "default DeepSeek" warning banner.
  // Persisted in localStorage so it stays dismissed across reloads. Resetting
  // is implicit: opening the settings dialog and saving a new config flips
  // `llmConfigured` true, which makes the banner condition false anyway.
  const [llmBannerDismissed, setLlmBannerDismissed] = useState(false);
  // Whether the 全文框架 panel is collapsed (only header visible). When
  // collapsed, the 原文段落导航 panel above automatically expands to fill
  // the freed vertical space.
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  // headingCollapsed was removed along with the HeadingNavigator panel —
  // paragraph navigation is now inside the 智能解析 toolbar.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blockReaderRef = useRef<BlockReaderHandle>(null);

  // ── Share button state ─────────────────────────────────────────────────
  // When the user clicks "分享", we generate a URL with ?paperId=xxx and
  // copy it to the clipboard. We also push it to the browser address bar
  // so the user can see exactly what link they're sharing. The checkmark
  // icon shows for 2s to confirm.
  //
  // IMPORTANT: When the recipient opens this URL, they see ONLY this
  // paper's content (PDF + parsed text + analysis outline + figures).
  // They do NOT see the sharer's browsing history, chat messages, or
  // any other state — every visit to a shared URL starts a fresh React
  // session that loads only this paper from the server via /api/paper/[id].
  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = useCallback(async () => {
    if (!paperId) return;
    try {
      const url = `${window.location.origin}/app?paperId=${paperId}`;
      console.log(`[share] generated URL: ${url}`);

      // Push the share URL into the address bar WITHOUT reloading the
      // page. This way:
      //   1. The user can see / copy the URL directly from the address bar
      //      (useful in WeChat in-app browser where clipboard API may be
      //      restricted).
      //   2. If the user reloads, the page reloads as a "shared paper"
      //      view (same as what the recipient will see).
      try {
        window.history.replaceState(null, "", url);
      } catch {
        /* ignore — some embed browsers block this */
      }

      // Try the modern clipboard API first; fall back to a hidden textarea
      // for older browsers / non-secure contexts (notably WeChat X5).
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(url);
          copied = true;
        } catch {
          // Clipboard API may be blocked by embed browser — fall through
          // to execCommand fallback.
        }
      }
      if (!copied) {
        try {
          const ta = document.createElement("textarea");
          ta.value = url;
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          ta.style.top = "0";
          ta.setAttribute("readonly", "");
          document.body.appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, url.length);
          document.execCommand("copy");
          document.body.removeChild(ta);
          copied = true;
        } catch {
          /* fall through to prompt */
        }
      }
      if (!copied) {
        // Last-resort: open a prompt with the URL so the user can
        // long-press → copy manually (common in WeChat).
        window.prompt("长按复制分享链接：", url);
      }
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (e) {
      console.warn("[share] copy failed:", e);
      const url = `${window.location.origin}/app?paperId=${paperId}`;
      window.prompt("长按复制分享链接：", url);
    }
  }, [paperId]);


  // On mount, check if the user previously dismissed the banner.
  useEffect(() => {
    try {
      setLlmBannerDismissed(localStorage.getItem("medreader.llm.bannerDismissed") === "1");
    } catch {
      // ignore
    }
  }, []);

  // Re-check LLM config status whenever the dialog closes
  useEffect(() => {
    setLlmConfigured(hasUserLLMConfig());
  }, [llmSettingsOpen]);

  // Build a headers snapshot for outgoing fetches; refresh when dialog closes.
  // We expose this via a ref-like state so child ChatPanel/TranslationPanel can
  // pick it up. For simplicity we put headers into window-level var (the chat
  // panel reads LLM headers from the latest snapshot via a custom hook).
  const [llmHeaders, setLlmHeaders] = useState<Record<string, string>>({});
  useEffect(() => {
    setLlmHeaders(refreshLLMHeaders());
  }, [llmSettingsOpen]);

  // Listen for "analysis updated" events — triggered by OutlinePanel's retry
  // button after a successful partial retry. We refresh the outline from the
  // server so the new content shows up.
  useEffect(() => {
    const handler = async () => {
      if (!paperId) return;
      try {
        const res = await fetch(`/api/analyze?paperId=${paperId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.outline) {
            setOutline(data.outline as Outline);
          }
        }
      } catch (e) {
        console.warn("[analysis-updated] refresh failed:", e);
      }
    };
    window.addEventListener("medreader:analysis-updated", handler);
    return () => window.removeEventListener("medreader:analysis-updated", handler);
  }, [paperId]);

  // ── Shared-paper URL loader ────────────────────────────────────────────
  // When the URL contains ?paperId=xxx (or ?p=xxx), treat it as a shared
  // paper: load the PDF binary + parsed content + analysis from the server
  // so the recipient can view everything without re-uploading.
  //
  // User request: "我分享给别人现在其他功能都是正常的就pdf渲染还是不对"
  // — when sharing, all features work EXCEPT the PDF preview, because the
  //   PdfViewer needs an ArrayBuffer that only the original uploader had.
  //   This loader fetches the PDF from /api/paper/[id]/pdf and feeds it to
  //   PdfViewer, restoring the PDF preview for shared-paper recipients.
  //
  // This runs once on mount. If the user later uploads their own PDF, the
  // normal onFile() flow takes over and overwrites the shared state.
  const sharedLoadRanRef = useRef(false);
  useEffect(() => {
    if (sharedLoadRanRef.current) return;
    sharedLoadRanRef.current = true;

    // Only run in the browser — server-side this is a no-op.
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const sharedId = params.get("paperId") || params.get("p");
    console.log(`[shared] mount, URL paperId param = ${sharedId ? `"${sharedId}"` : "(none)"}`);
    if (!sharedId) {
      // No paperId in URL → this is a fresh visit, show the empty state
      // (NOT a previous user's state). The empty state is "点击导入 PDF".
      console.log("[shared] no paperId → showing empty homepage (fresh visit)");
      return;
    }

    // Mark as "loading a shared paper" so the UI shows progress
    setUploadStage("parsing");
    setMineruStatus("正在加载分享的论文…");
    setOutlineCollapsed(false);
    console.log(`[shared] loading paper ${sharedId} from server`);

    (async () => {
      const t0 = performance.now();
      try {
        // 1. Fetch paper metadata + parsed content
        console.log(`[shared] GET /api/paper/${sharedId}`);
        const paperRes = await fetch(`/api/paper/${sharedId}`);
        if (!paperRes.ok) {
          throw new Error(`Paper fetch failed: HTTP ${paperRes.status}`);
        }
        const paperData = await paperRes.json();
        console.log(`[shared] paper metadata loaded: title="${paperData.title}", hasMarkdown=${!!paperData.markdown}, hasBlocks=${!!paperData.blocks}`);

        // 2. Fetch PDF binary (for PdfViewer)
        let pdfBuf: ArrayBuffer | null = null;
        try {
          console.log(`[shared] GET /api/paper/${sharedId}/pdf`);
          const pdfRes = await fetch(`/api/paper/${sharedId}/pdf`);
          if (pdfRes.ok) {
            pdfBuf = await pdfRes.arrayBuffer();
            console.log(`[shared] PDF binary loaded: ${pdfBuf.byteLength} bytes`);
          } else {
            console.warn(`[shared] PDF binary fetch returned HTTP ${pdfRes.status}`);
          }
        } catch (e) {
          console.warn("[shared] PDF binary fetch failed:", e);
        }

        // 3. Apply state — similar to onFile's post-upload state
        setPaperId(sharedId);
        setFileName(paperData.title || "shared-paper.pdf");
        setPaperText(paperData.parsedText || "");
        setPaperMarkdown(paperData.markdown || null);
        setPaperBlocks(paperData.blocks || null);
        setPaperImagesDir(paperData.imagesDir || null);
        // Citations are returned by /api/paper/[id] as `citations` (already
        // parsed from citationsJson). Set them here so the figure chain can
        // use them for panel-chip click jumps.
        if (Array.isArray(paperData.citations)) {
          setCitations(paperData.citations as Citation[]);
        }
        if (pdfBuf) {
          setFileData(pdfBuf);
        }
        // Default to PDF view if we have the binary; otherwise blocks view
        if (pdfBuf) {
          setActiveView("pdf");
        } else if (paperData.blocks || paperData.markdown) {
          setActiveView("blocks");
        }
        setUploadStage("analyzing");
        setMineruStatus("正在加载分析结果…");

        // 4. Fetch the analysis outline
        try {
          const analyzeRes = await fetch(`/api/analyze?paperId=${sharedId}`);
          if (analyzeRes.ok) {
            const analyzeData = await analyzeRes.json();
            if (analyzeData.outline) {
              setOutline(analyzeData.outline as Outline);
            }
          }
        } catch (e) {
          console.warn("[shared] analyze fetch failed:", e);
        }

        // 5. Fetch figures (Call A result) — if figures exist, mark status as done
        try {
          const figRes = await fetch(`/api/figures?paperId=${sharedId}`);
          if (figRes.ok) {
            const figData = await figRes.json();
            if (Array.isArray(figData.figures)) {
              setFigures(figData.figures);
              if (figData.figures.length > 0) {
                setFiguresStatus("done");
              } else {
                setFiguresStatus("idle");
              }
            }
          }
        } catch (e) {
          console.warn("[shared] figures fetch failed:", e);
        }

        setUploadStage("done");
        setMineruStatus("");
        console.log(`[shared] done in ${Math.round(performance.now() - t0)}ms — paper "${paperData.title}" is now visible to the recipient`);
      } catch (e) {
        console.error("[shared] load failed:", e);
        setOutlineError(
          e instanceof Error
            ? `加载分享的论文失败：${e.message}`
            : "加载分享的论文失败"
        );
        setUploadStage("idle");
        setMineruStatus("");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissLlmBanner = useCallback(() => {
    setLlmBannerDismissed(true);
    try {
      localStorage.setItem("medreader.llm.bannerDismissed", "1");
    } catch {
      // ignore
    }
  }, []);

  const onFile = useCallback(
    async (file: File) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        alert("目前仅支持 PDF 格式");
        return;
      }
      // 50 MB hard cap — matches server-side MAX_UPLOAD_BYTES in
      // src/app/api/upload/route.ts and `bodySizeLimit` in next.config.ts.
      // Rejecting on the client avoids a wasted round-trip for files the
      // server will refuse anyway.
      const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
      if (file.size > MAX_UPLOAD_BYTES) {
        alert(
          `文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），单文件上限 50 MB。请拆分或压缩后上传。`
        );
        return;
      }
      const buf = await file.arrayBuffer();
      const bufForText = buf.slice(0);
      setFileData(buf);
      setFileName(file.name);
      setOutline(null);
      setOutlineError(null);
      setSelectedText("");
      setSelectedBlockIdx(null);
      setAttachedImage(null);
      setActiveChildId(undefined);
      setPaperMarkdown(null);
      setPaperBlocks(null);
      setPaperImagesDir(null);
      // Reset Stage 2 state for the new upload
      setFigures([]);
      setCitations([]);
      setFiguresStatus("idle");
      setFiguresLoading(false);
      // Left panel: 全文框架 starts (and stays) expanded so the user can
      // see the "MinerU 正在加载" / "Agent 正在分析" progress indicator.
      // It no longer auto-collapses after Stage 1 results arrive — user
      // can manually collapse via the ChevronRight in the panel header.
      setOutlineCollapsed(false);
      // Default the center view to PDF while the MinerU parse runs (it takes
      // 30-90s). The user sees their PDF immediately instead of a blank
      // "parsing…" placeholder. When the parsed markdown/blocks arrive we
      // auto-switch to 智能解析 — unless the user has already picked a tab
      // themselves (in which case we respect their choice).
      setActiveView("pdf");
      userTouchedTabRef.current = false;
      setUploadStage("uploading");
      setMineruStatus("上传中…");

      // Upload to server — quota is checked server-side.
      let serverPaperId: string | null = null;
      let serverParsedText: string | null = null;
      let serverMarkdown: string | null = null;
      let serverBlocks: MinerUBlock[] | null = null;
      let serverImagesDir: string | null = null;
      try {
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (upRes.status === 401) {
          const j = await upRes.json().catch(() => ({}));
          // Session expired mid-session — bounce to login.
          window.location.href = `/login?callbackUrl=${encodeURIComponent("/app")}`;
          throw new Error(j.error || "请先登录");
        }
        if (upRes.status === 413) {
          const j = await upRes.json().catch(() => ({}));
          throw new Error(j.error || "文件过大（上限 50 MB），请拆分或压缩后上传");
        }
        if (upRes.status === 429) {
          const j = await upRes.json().catch(() => ({}));
          throw new Error(j.error || "今日解析额度已用尽");
        }
        if (!upRes.ok) {
          const j = await upRes.json().catch(() => ({}));
          throw new Error(j.error || `Upload failed HTTP ${upRes.status}`);
        }
        const upData = await upRes.json();
        serverPaperId = upData.paperId;
        setPaperId(upData.paperId);
        setUploadStage("parsing");
        setMineruStatus("MinerU 解析中（30-90 秒）…");

        // Poll for parse status
        let pollTimeoutReached = true;
        let pollLastError: string | null = null;
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          let sRes: Response;
          try {
            sRes = await fetch(`/api/paper/${upData.paperId}`);
          } catch (netErr) {
            // 网络抖包或服务重启——记下来，但不中断轮询
            pollLastError = `网络错误：${netErr instanceof Error ? netErr.message : String(netErr)}`;
            if (i % 5 === 0) {
              setMineruStatus(`解析中…（已等 ${(i + 1) * 2}s· 重连中）`);
            }
            continue;
          }
          if (!sRes.ok) {
            // 5xx / 4xx——同样记下来不中断，后台解析可能仍在走
            pollLastError = `HTTP ${sRes.status}`;
            if (i % 5 === 0) {
              setMineruStatus(`解析中…（已等 ${(i + 1) * 2}s· 状态查询 ${sRes.status}）`);
            }
            continue;
          }
          const sData = await sRes.json();
          if (sData.parseStatus === "done") {
            serverParsedText = sData.parsedText;
            serverMarkdown = sData.markdown;
            serverBlocks = sData.blocks;
            serverImagesDir = sData.imagesDir;
            pollTimeoutReached = false;
            break;
          }
          if (sData.parseStatus === "error") {
            pollTimeoutReached = false;
            throw new Error("MinerU 解析失败且 pdfjs 兜底也失败，请重试或换一份 PDF");
          }
          pollLastError = null;
          if (i % 5 === 0) {
            setMineruStatus(`MinerU 解析中…（已等 ${(i + 1) * 2}s）`);
          }
        }
        if (pollTimeoutReached) {
          // 4 分钟没拿到 done/error——后台可能仍在跑或已哑死
          throw new Error(
            `MinerU 解析超时（4 分钟未返回结果）。${
              pollLastError ? `最后状态：${pollLastError}。` : ""
            }请重试，或刷新后从历史记录中查看。`
          );
        }
      } catch (e) {
        setOutlineError(e instanceof Error ? e.message : String(e));
        setUploadStage("idle");
        setMineruStatus("");
        return;
      }

      // Use server-parsed content if available; otherwise client extraction
      let full = "";
      if (serverParsedText) {
        full = serverParsedText;
        // 检测「MinerU 失败但 pdfjs 兜底成功」的情形：
        // polling 返回 done + parsedText，但 markdown / blocks 仍是 null。
        // 这种情况下用户看到的是纯文本视图，没有任何图表/分块/标题结构，
        // 必须明确告诉用户发生了什么，否则会被当成「PDF 显示有问题」。
        if (!serverMarkdown && !serverBlocks) {
          setMineruStatus(
            "⚠️ MinerU 结构化解析失败，已切换到 pdfjs 简化模式（仅纯文本，无图表/分块视图）。可重试上传以获得完整结构。"
          );
        } else {
          setMineruStatus("");
        }
      } else {
        try {
          const lib = await import("pdfjs-dist");
          lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`;
          const doc = await lib.getDocument({ data: new Uint8Array(bufForText) }).promise;
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const tc = await page.getTextContent();
            const pageText = tc.items
              .map((it: any) => (typeof it.str === "string" ? it.str : ""))
              .join(" ");
            full += `\n[Page ${i}]\n${pageText}\n`;
            page.cleanup();
          }
        } catch (e) {
          // ignore; we'll still try analyze with empty text
        }
      }

      // Progressive: set plain text + markdown/blocks as soon as they're available.
      setPaperText(full);
      setPaperMarkdown(serverMarkdown);
      setPaperBlocks(serverBlocks);
      setPaperImagesDir(serverImagesDir);
      setMineruStatus("");

      // Auto-switch from the initial PDF view to 智能解析 now that the
      // parsed content is ready — but only if the user hasn't manually
      // picked a different tab during the wait. If they did, we leave
      // them on whatever they chose.
      if (!userTouchedTabRef.current && (serverBlocks || serverMarkdown)) {
        setActiveView("blocks");
      }

      // Trigger Stage 1 analysis (3 parallel LLM calls — questionBackground /
      // novelty / limitsOpportunities). Returns immediately with the 3 parts;
      // argumentSpine stays null until figures finish (Stage 2).
      setUploadStage("analyzing");
      setOutlineLoading(true);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...refreshLLMHeaders(),
          },
          body: JSON.stringify({
            text: full,
            markdown: serverMarkdown || undefined,
            title: file.name,
            paperId: serverPaperId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setOutline(data.outline);
        setUploadStage("done");
        // 用户最新反馈："开始的时候就展开成这样就可以了" — outline 出现后
        // 左侧 全文框架 保持展开（不再自动折叠），用户能看到第一层内容。
        // 之前的 auto-collapse 行为已废弃；用户可手动点 header 右上方的
        // ChevronRight 来折叠整个面板。
        setOutlineCollapsed(false);
      } catch (e) {
        setOutlineError(e instanceof Error ? e.message : String(e));
        setUploadStage("idle");
      } finally {
        setOutlineLoading(false);
      }

      // ── Stage 2: trigger figure analysis (Call A) in parallel with Stage 1.
      // This runs AFTER MinerU's figure extraction (which happened during
      // upload). Call A is one LLM call for all figures + writes back the
      // argumentSpine. We poll for completion so the UI updates as figures
      // become ready.
      // ─────────────────────────────────────────────────────────────────
      if (serverPaperId) {
        setFiguresLoading(true);
        setFiguresStatus("extracting");
        // Fire-and-forget the figures POST (Call A). It writes to DB on
        // completion; we poll the GET endpoint for results.
        fetch("/api/figures", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...refreshLLMHeaders(),
          },
          body: JSON.stringify({ paperId: serverPaperId }),
        }).catch((e) => {
          console.warn("[figures] Call A trigger failed:", e);
          setFiguresStatus("error");
        });

        // Poll for figures + updated analysisJson + citations.
        // We also drive the figuresStatus state machine here so the
        // OutlinePanel 论证主线 progress indicator reflects the current
        // sub-step (extracting → call-a → spine → done).
        let pollCount = 0;
        const poll = async () => {
          pollCount++;
          try {
            const [figRes, analysisRes, paperRes] = await Promise.all([
              fetch(`/api/figures?paperId=${serverPaperId}`).then((r) => r.json()),
              fetch(`/api/analyze?paperId=${serverPaperId}`).then((r) => r.json()),
              fetch(`/api/paper/${serverPaperId}`).then((r) => r.json()),
            ]);
            if (Array.isArray(figRes.figures)) {
              setFigures(figRes.figures as Figure[]);
            }
            // Refresh outline if analysisJson has been updated (spine filled)
            if (analysisRes.outline) {
              setOutline(analysisRes.outline as Outline);
            }
            // Load citations (for panel chip click → quote jump)
            if (Array.isArray(paperRes.citations)) {
              setCitations(paperRes.citations as Citation[]);
            }

            // ── Drive the figuresStatus state machine ──
            const figs: Figure[] = Array.isArray(figRes.figures) ? figRes.figures : [];
            const allHaveQuestion =
              figs.length > 0 && figs.every((f) => f.question);
            const spineReady = !!analysisRes.outline?.argumentSpine;

            if (spineReady && allHaveQuestion) {
              setFiguresStatus("done");
              setFiguresLoading(false);
              return; // stop polling
            }
            if (allHaveQuestion && !spineReady) {
              setFiguresStatus("spine");
            } else if (figs.length > 0 && !allHaveQuestion) {
              setFiguresStatus("call-a");
            } else if (pollCount > 1) {
              // After 2+ polls still no figures — likely Call A still
              // processing or figure extraction slow. Stay in extracting.
              setFiguresStatus("extracting");
            }

            // Safety: stop after ~6 minutes of polling (90 iterations × 4s)
            if (pollCount > 90) {
              console.warn("[poll] exhausted 90 iterations, giving up");
              setFiguresStatus("error");
              setFiguresLoading(false);
              return;
            }
          } catch (e) {
            console.warn("[poll] figures/analyze fetch failed:", e);
          }
          setTimeout(poll, 4000);
        };
        setTimeout(poll, 3000);
      }
    },
    []
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFile(f);
    e.target.value = "";
  };

  /** PDF text selection handler (legacy, for the PDF tab). */
  const onTextSelect = useCallback((text: string) => {
    setSelectedText(text);
    setSelectedBlockIdx(null);
    setSelectionNonce((n) => n + 1);
  }, []);

  /** BlockReader paragraph click — fires translation + marks active block. */
  const onParagraphClick = useCallback((text: string, blockIdx: number) => {
    setSelectedText(text);
    setSelectedBlockIdx(blockIdx);
    setSelectionNonce((n) => n + 1);
  }, []);

  const onImageSelect = useCallback((b64: string) => {
    setAttachedImage(b64);
  }, []);

  /**
   * Outline-child click — jump to the related paragraph.
   * Does NOT force-switch the tab. If we're in mindmap view, switch to blocks
   * (because the mindmap can't show a jump). Otherwise stay in current view.
   */
  const onChildClick = useCallback(
    (child: OutlineChild, _section: OutlineSection) => {
      setActiveChildId(child.id);
      setHighlightToken({
        quote: child.quote || "",
        keywords: child.keywords || [],
        nonce: Date.now(),
      });
      // Only auto-switch out of mindmap view (which can't display jumps)
      if (activeView === "mindmap") {
        setActiveView("blocks");
      }
      // Tell BlockReader imperatively too (in case it's already mounted)
      setTimeout(() => {
        blockReaderRef.current?.scrollToText(child.quote || "", child.keywords || []);
      }, 50);
    },
    [activeView]
  );

  // Heading-navigator click handler was removed — paragraph navigation is
  // now handled inside BlockReader via the side drawer (no parent wiring
  // needed). activeHeadingText is kept for potential future use but no
  // longer drives any UI.

  const stageLabel: Record<UploadStage, string> = {
    idle: "",
    uploading: "上传中…",
    parsing: "MinerU 解析中…",
    analyzing: "AI 分析中…",
    done: "分析完成",
  };

  const isBusy = outlineLoading || uploadStage === "uploading" || uploadStage === "parsing";

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="glass-header h-12 flex-shrink-0 flex items-center px-4 gap-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shadow-sm">
            <BookOpen className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm text-background">MedReader Agent</span>
          <span className="text-[10px] opacity-70 hidden sm:inline">
            MinerU 驱动 · 智能解析
          </span>
        </div>

        <div className="flex-1" />

        {/* Upload stage indicator */}
        {uploadStage !== "idle" && uploadStage !== "done" && (
          <span className="text-[11px] opacity-90 flex items-center gap-1.5 mr-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            {stageLabel[uploadStage]}
          </span>
        )}

        {/* LLM settings button + warning if not configured */}
        <Button
          variant="ghost"
          size="sm"
          className={
            "h-8 gap-1.5 text-background hover:bg-background/10 " +
            (!llmConfigured ? "ring-1 ring-amber-300/60" : "")
          }
          onClick={() => setLlmSettingsOpen(true)}
          title="LLM 模型设置"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-xs hidden sm:inline">模型设置</span>
          {!llmConfigured && (
            <AlertTriangle className="h-3 w-3 text-amber-300" />
          )}
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={onFileInput}
          className="hidden"
        />
        <Button
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5"
          disabled={isBusy}
        >
          {isBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          导入 PDF
        </Button>

        {/* Download dropdown — placed right next to the import button.
            Disabled until the analysis outline is ready. Two export options:
            1) Markdown 智能分析版本 (structured .md with 4-layer analysis +
               figure captions + 限制/机会 pairs)
            2) HTML 思维导图 (standalone self-contained .html file that
               renders the 4 sections as poster-style cards)
            Both files are generated client-side and download instantly. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className="h-8 gap-1.5"
              disabled={!outline}
              title={outline ? "下载分析结果" : "需先完成智能分析"}
            >
              <Download className="h-3.5 w-3.5" />
              下载
              <ChevronDown className="h-3 w-3 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              disabled={!outline}
              onClick={() => outline && exportAnalysisMarkdown(outline, figures)}
              className="gap-2 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5 flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-[12px] font-medium">智能分析版本</span>
                <span className="text-[10px] text-muted-foreground">
                  Markdown · 4 层结构 + 图注
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!outline}
              onClick={() => outline && exportMindmapHtml(outline, figures)}
              className="gap-2 cursor-pointer"
            >
              <FileCode2 className="h-3.5 w-3.5 flex-shrink-0" />
              <div className="flex flex-col">
                <span className="text-[12px] font-medium">HTML 思维导图</span>
                <span className="text-[10px] text-muted-foreground">
                  独立网页 · 可打印为 PDF
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Share button — generates a URL with ?paperId=xxx that the
            recipient can open to view the same paper + analysis + PDF.
            Disabled until a paper is loaded (paperId is set).
            User request: "我分享给别人现在其他功能都是正常的就pdf渲染还是不对"
            — this button + the /api/paper/[id]/pdf route together restore
            the PDF preview for shared-paper recipients. */}
        <Button
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5"
          disabled={!paperId}
          onClick={handleShare}
          title={paperId ? "复制分享链接" : "需先导入或加载一份论文"}
        >
          {shareCopied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Share2 className="h-3.5 w-3.5" />
          )}
          {shareCopied ? "已复制" : "分享"}
        </Button>

        {/* Auth area */}
        {status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin opacity-70" />
        ) : session?.user ? (
          <div className="flex items-center gap-2 ml-2">
            {(session.user as any).role === "admin" && (
              <Link href="/admin">
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/10">
                  <Shield className="h-3.5 w-3.5" />
                  管理
                </Button>
              </Link>
            )}
            <span className="text-xs opacity-90 max-w-[120px] truncate">
              {(session.user as any).name || session.user.email}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-background hover:bg-background/10"
              onClick={() => signOut({ callbackUrl: "/" })}
              title="登出"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Link href="/login" className="ml-2">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/10">
              <LogIn className="h-3.5 w-3.5" />
              登录
            </Button>
          </Link>
        )}
      </header>

      {/* LLM not-configured banner — dismissible */}
      {!llmConfigured && !llmBannerDismissed && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-[11px] px-4 py-1.5 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1">
            当前使用服务端默认 DeepSeek 配置。如需更换 LLM（OpenAI / 智谱 / Moonshot / 自定义 OpenAI 兼容端点），
            请点击右上角「模型设置」。
          </span>
          <button
            onClick={dismissLlmBanner}
            title="不再提示"
            className="flex-shrink-0 p-1 rounded hover:bg-amber-200/60 dark:hover:bg-amber-800/40 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 5-panel resizable layout */}
      <div className="flex-1 min-h-0 hidden md:block">
        <PanelGroup direction="horizontal" autoSaveId="medreader-h">
          {/* Left: Outline Panel only (4-layer 全文框架 + Figure 链) —
              HeadingNavigator was removed; paragraph navigation is now a
              button inside the 智能解析 toolbar (opens a side drawer). */}
          <Panel defaultSize={20} minSize={14} collapsible={false}>
            <div className="h-full border-r bg-card flex flex-col">
              <div
                className={cn(
                  "min-h-0",
                  outlineCollapsed ? "flex-shrink-0" : "flex-1 overflow-hidden"
                )}
              >
                <OutlinePanel
                  outline={outline}
                  loading={outlineLoading}
                  onChildClick={onChildClick}
                  activeChildId={activeChildId}
                  collapsed={outlineCollapsed}
                  onCollapsedChange={setOutlineCollapsed}
                  paperId={paperId}
                  figures={figures}
                  citations={citations}
                  figuresStatus={figuresStatus}
                  uploadStage={uploadStage}
                  mineruStatus={mineruStatus}
                  onPanelChipClick={(quote, pageIndex) => {
                    // Jump to the citing sentence in BOTH views:
                    //  - 智能解析 (blocks): use highlightToken (quote-based match)
                    //  - 原文 PDF: use jumpToPage (direct page scroll)
                    setHighlightToken({
                      quote,
                      keywords: [],
                      nonce: Date.now(),
                    });
                    if (pageIndex && pageIndex > 0) {
                      setJumpToPage({ pageIndex, nonce: Date.now() });
                    }
                    // Stay in current view if user is in blocks; otherwise
                    // switch to blocks so they see the highlight.
                    if (activeView === "mindmap" || activeView === "pdf") {
                      setActiveView("blocks");
                    }
                    setTimeout(() => {
                      blockReaderRef.current?.scrollToText(quote, []);
                    }, 50);
                  }}
                  onJumpToPage={(pageIndex) => {
                    // Switch to PDF view + signal PdfViewer to scroll to that page.
                    setActiveView("pdf");
                    // Defer the jump so PdfViewer has mounted before it tries
                    // to scroll (otherwise pagesRef is empty).
                    setTimeout(() => {
                      setJumpToPage({ pageIndex, nonce: Date.now() });
                    }, 80);
                  }}
                />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle-h" />

          {/* Center: Blocks / PDF / Mindmap tabs */}
          <Panel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col bg-muted/30">
              <Tabs
                value={activeView}
                onValueChange={(v) => {
                  setActiveView(v as "blocks" | "pdf" | "mindmap");
                  // User has manually chosen a tab — don't auto-switch later.
                  markTabTouched();
                }}
                className="flex-1 flex flex-col min-h-0"
              >
                <div className="border-b bg-background/80 backdrop-blur-sm px-3 py-1.5 flex items-center gap-2">
                  <TabsList className="h-8">
                    <TabsTrigger value="pdf" className="text-xs gap-1.5 h-7">
                      <FileText className="h-3.5 w-3.5" />
                      原文 PDF
                    </TabsTrigger>
                    <TabsTrigger value="blocks" className="text-xs gap-1.5 h-7">
                      <LayoutGrid className="h-3.5 w-3.5" />
                      智能解析
                    </TabsTrigger>
                    <TabsTrigger value="mindmap" className="text-xs gap-1.5 h-7">
                      <Network className="h-3.5 w-3.5" />
                      思维导图
                    </TabsTrigger>
                  </TabsList>
                  {/* Display the real paper title (extracted from the PDF
                      by MinerU) when available. Fall back to the filename
                      only while the paper is still being parsed or if title
                      extraction failed. */}
                  {(outline?.title || fileName) && (
                    <span
                      className="text-[11px] text-muted-foreground truncate max-w-[360px]"
                      title={outline?.title || fileName}
                    >
                      {outline?.title || fileName}
                    </span>
                  )}
                </div>

                <TabsContent
                  value="blocks"
                  className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden"
                >
                  <BlockReader
                    ref={blockReaderRef}
                    fallbackText={paperText}
                    markdown={paperMarkdown}
                    blocks={paperBlocks}
                    imagesDir={paperImagesDir}
                    loading={uploadStage === "parsing" || uploadStage === "uploading"}
                    statusMessage={mineruStatus}
                    onParagraphClick={onParagraphClick}
                    highlightToken={highlightToken}
                  />
                </TabsContent>

                <TabsContent
                  value="pdf"
                  className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden"
                >
                  <PdfViewer
                    fileData={fileData}
                    fileName={fileName}
                    onTextSelect={onTextSelect}
                    onImageSelect={onImageSelect}
                    highlightToken={highlightToken}
                    jumpToPage={jumpToPage}
                  />
                </TabsContent>

                <TabsContent
                  value="mindmap"
                  className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden"
                >
                  <MindmapView
                    outline={outline}
                    figures={figures}
                    onChildClick={onChildClick}
                    onFigureClick={(figureLabel) => {
                      // Jump back to left panel — expand that figure card.
                      // For now we just switch to blocks view; the left panel
                      // will show the figure card.
                      // (The user can manually expand it — we'd need to add
                      // imperative API to OutlinePanel for auto-expand.)
                      console.log(`[onFigureClick] ${figureLabel}`);
                      // Switch out of mindmap to blocks
                      setActiveView("blocks");
                    }}
                  />
                </TabsContent>

              </Tabs>
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle-h" />

          {/* Right: translation + chat */}
          <Panel defaultSize={30} minSize={24}>
            <PanelGroup direction="vertical" autoSaveId="medreader-right-v">
              <Panel defaultSize={42} minSize={20}>
                <div className="h-full border-b bg-card">
                  <TranslationPanel
                    selectedText={selectedText}
                    selectedBlockIdx={selectedBlockIdx}
                    selectionNonce={selectionNonce}
                    llmHeaders={llmHeaders}
                  />
                </div>
              </Panel>
              <PanelResizeHandle className="resize-handle-v" />
              <Panel defaultSize={58} minSize={20}>
                <div className="h-full bg-card">
                  <ChatPanel
                    attachedImage={attachedImage}
                    onClearAttachedImage={() => setAttachedImage(null)}
                    selectedText={selectedText}
                    paperMarkdown={paperMarkdown || undefined}
                    paperText={paperText || undefined}
                    paperId={paperId}
                    llmHeaders={llmHeaders}
                  />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      {/* Outline error toast */}
      {outlineError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[600px]">
          <div className="bg-destructive/10 border border-destructive/30 text-destructive text-xs px-4 py-2.5 rounded-md shadow-lg flex items-center gap-2">
            <Info className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{outlineError}</span>
            <button
              className="ml-2 underline"
              onClick={() => setOutlineError(null)}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* LLM settings dialog */}
      <LLMSettingsDialog
        open={llmSettingsOpen}
        onOpenChange={setLlmSettingsOpen}
        onSaved={() => {
          setLlmHeaders(refreshLLMHeaders());
          setLlmConfigured(hasUserLLMConfig());
        }}
      />

      {/* Mobile / small screen warning */}
      <div className="md:hidden fixed inset-0 bg-background z-50 flex items-center justify-center p-6 text-center">
        <div className="space-y-3">
          <BookOpen className="h-10 w-10 mx-auto text-primary" />
          <p className="text-sm font-medium">请使用更大屏幕访问</p>
          <p className="text-xs text-muted-foreground">
            MedReader Agent 需要至少 1024px 宽度以同时显示五个面板
          </p>
        </div>
      </div>
    </div>
  );
}
