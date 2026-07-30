"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useSession, signOut } from "next-auth/react";
import PdfViewer from "@/components/pdf-viewer";
import OutlinePanel, {
  type Outline,
  type OutlineChild,
  type OutlineSection,
  type PaperHeading,
} from "@/components/outline-panel";
import TranslationPanel from "@/components/translation-panel";
import ChatPanel from "@/components/chat-panel";
import MindmapView from "@/components/mindmap-view";
import BlockReader, { type MinerUBlock, type BlockReaderHandle } from "@/components/block-reader";
import HeadingNavigator from "@/components/heading-navigator";
import LLMSettingsDialog, {
  refreshLLMHeaders,
  hasUserLLMConfig,
} from "@/components/llm-settings-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
} from "lucide-react";
import Link from "next/link";

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
  const [activeChildId, setActiveChildId] = useState<string | undefined>();
  const [activeHeadingText, setActiveHeadingText] = useState<string | undefined>();
  const [activeView, setActiveView] = useState<"blocks" | "pdf" | "mindmap">("blocks");
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
  // Mirror state for 原文段落导航. Both panels start collapsed when a new
  // analysis result arrives (user request: "在产生结果之后先上下折叠"),
  // so the user sees the document content first and can expand either panel
  // by clicking its header.
  const [headingCollapsed, setHeadingCollapsed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blockReaderRef = useRef<BlockReaderHandle>(null);

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
      const buf = await file.arrayBuffer();
      const bufForText = buf.slice(0);
      setFileData(buf);
      setFileName(file.name);
      setOutline(null);
      setOutlineError(null);
      setSelectedText("");
      setSelectedBlockIdx(null);
      setAttachedImage(null);
      setActiveHeadingText(undefined);
      setActiveChildId(undefined);
      setPaperMarkdown(null);
      setPaperBlocks(null);
      setPaperImagesDir(null);
      // Reset both left-panel collapse states at the start of a new upload
      // so the panels are visible while loading (showing "analyzing…"), then
      // auto-collapse once results arrive (see the setOutline call below).
      setOutlineCollapsed(false);
      setHeadingCollapsed(false);
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
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const sRes = await fetch(`/api/paper/${upData.paperId}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData.parseStatus === "done") {
              serverParsedText = sData.parsedText;
              serverMarkdown = sData.markdown;
              serverBlocks = sData.blocks;
              serverImagesDir = sData.imagesDir;
              break;
            }
            if (sData.parseStatus === "error") {
              throw new Error("MinerU 解析失败，已尝试 pdfjs 兜底");
            }
            if (i % 5 === 0) {
              setMineruStatus(`MinerU 解析中…（已等 ${(i + 1) * 2}s）`);
            }
          }
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

      // Trigger analysis using markdown (preferred) or plain text
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
        // User request: "在产生结果之后先上下折叠" — after analysis results
        // are produced, both left panels (原文段落导航 + 全文框架) start
        // collapsed so the center reader gets maximum screen real estate.
        // The user can click either header to expand.
        setOutlineCollapsed(true);
        setHeadingCollapsed(true);
      } catch (e) {
        setOutlineError(e instanceof Error ? e.message : String(e));
        setUploadStage("idle");
      } finally {
        setOutlineLoading(false);
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
      setActiveHeadingText(undefined);
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

  /**
   * Heading-navigator click — verbatim paper H2/H3 heading.
   * Use the heading text itself as the quote (so the fuzzy matcher will find
   * the exact heading block in the block reader). Don't force-switch tabs.
   */
  const onHeadingClick = useCallback(
    (h: PaperHeading) => {
      setActiveHeadingText(h.text);
      setActiveChildId(undefined);
      setHighlightToken({
        quote: h.text,
        keywords: [],
        nonce: Date.now(),
      });
      if (activeView === "mindmap") {
        setActiveView("blocks");
      }
      setTimeout(() => {
        blockReaderRef.current?.scrollToText(h.text, []);
      }, 50);
    },
    [activeView]
  );

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
            MinerU 驱动 · 分块阅读
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
          {/* Left: Heading Navigator (top) + Outline Panel (bottom) */}
          <Panel defaultSize={20} minSize={14} collapsible={false}>
            <div className="h-full border-r bg-card flex flex-col">
              {/* HeadingNavigator at top — verbatim paper section/subsection
                  titles, used for precise paragraph jumping. When 全文框架
                  is collapsed below (and this panel is expanded), this panel
                  grows to fill the space. Both panels share the same
                  controlled collapse pattern (chevron-right header button)
                  and both auto-collapse when new analysis results arrive. */}
              <div
                className={cn(
                  "min-h-0",
                  // HeadingNavigator expands only when 全文框架 below is
                  // collapsed AND this panel itself is expanded.
                  outlineCollapsed && !headingCollapsed ? "flex-1" : "flex-shrink-0"
                )}
              >
                <HeadingNavigator
                  headings={outline?.headings}
                  activeHeadingText={activeHeadingText}
                  onHeadingClick={onHeadingClick}
                  fillContainer={outlineCollapsed && !headingCollapsed}
                  collapsed={headingCollapsed}
                  onCollapsedChange={setHeadingCollapsed}
                />
              </div>
              {/* Outline (6-dimension LLM-generated analysis) at bottom.
                  When `outlineCollapsed` is true, this panel shrinks to
                  header-only and the parent flex-1 is dropped so the
                  HeadingNavigator above can grow.
                  If BOTH panels are collapsed, we add flex-1 to the
                  OutlinePanel wrapper so it pushes the HeadingNavigator
                  header to the top and absorbs the leftover space — that
                  way the empty area is part of the OutlinePanel header's
                  background, not a weird gap. */}
              <div
                className={cn(
                  "border-t",
                  outlineCollapsed
                    ? headingCollapsed
                      ? "flex-1 min-h-0" // both collapsed: absorb space
                      : "flex-shrink-0"    // only outline collapsed: header-only
                    : "flex-1 min-h-0 overflow-hidden" // neither collapsed
                )}
              >
                <OutlinePanel
                  outline={outline}
                  loading={outlineLoading}
                  onChildClick={onChildClick}
                  activeChildId={activeChildId}
                  collapsed={outlineCollapsed}
                  onCollapsedChange={setOutlineCollapsed}
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
                onValueChange={(v) => setActiveView(v as "blocks" | "pdf" | "mindmap")}
                className="flex-1 flex flex-col min-h-0"
              >
                <div className="border-b bg-background/80 backdrop-blur-sm px-3 py-1.5 flex items-center gap-2">
                  <TabsList className="h-8">
                    <TabsTrigger value="blocks" className="text-xs gap-1.5 h-7">
                      <LayoutGrid className="h-3.5 w-3.5" />
                      分块阅读
                    </TabsTrigger>
                    <TabsTrigger value="pdf" className="text-xs gap-1.5 h-7">
                      <FileText className="h-3.5 w-3.5" />
                      原文 PDF
                    </TabsTrigger>
                    <TabsTrigger value="mindmap" className="text-xs gap-1.5 h-7">
                      <Network className="h-3.5 w-3.5" />
                      思维导图
                    </TabsTrigger>
                  </TabsList>
                  {fileName && (
                    <span className="text-[11px] text-muted-foreground truncate max-w-[300px]">
                      {fileName}
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
                  />
                </TabsContent>

                <TabsContent
                  value="mindmap"
                  className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden"
                >
                  <MindmapView outline={outline} onChildClick={onChildClick} />
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
