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
import TranslationPanel from "@/components/translation-panel";
import ChatPanel from "@/components/chat-panel";
import MindmapView from "@/components/mindmap-view";
import BlockReader, { type MinerUBlock, type BlockReaderHandle } from "@/components/block-reader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  const [activeView, setActiveView] = useState<"blocks" | "pdf" | "mindmap">("blocks");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blockReaderRef = useRef<BlockReaderHandle>(null);

  const onFile = useCallback(async (file: File) => {
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
    setPaperMarkdown(null);
    setPaperBlocks(null);
    setPaperImagesDir(null);
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
          // Still pending/running — update status message
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
        headers: { "Content-Type": "application/json" },
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
    } catch (e) {
      setOutlineError(e instanceof Error ? e.message : String(e));
      setUploadStage("idle");
    } finally {
      setOutlineLoading(false);
    }
  }, []);

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

  const onChildClick = useCallback(
    (child: OutlineChild, _section: OutlineSection) => {
      setActiveChildId(child.id);
      setHighlightToken({
        quote: child.quote || "",
        keywords: child.keywords || [],
        nonce: Date.now(),
      });
      // Auto-switch to block reader so the highlight is visible
      setActiveView("blocks");
      // Also tell BlockReader imperatively (in case it's already mounted)
      setTimeout(() => {
        blockReaderRef.current?.scrollToText(child.quote || "", child.keywords || []);
      }, 50);
    },
    []
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

      {/* 5-panel resizable layout */}
      <div className="flex-1 min-h-0 hidden md:block">
        <PanelGroup direction="horizontal" autoSaveId="medreader-h">
          {/* Left: Outline */}
          <Panel defaultSize={18} minSize={14} collapsible={false}>
            <div className="h-full border-r bg-card">
              <OutlinePanel
                outline={outline}
                loading={outlineLoading}
                onChildClick={onChildClick}
                activeChildId={activeChildId}
              />
            </div>
          </Panel>
          <PanelResizeHandle className="resize-handle-h" />

          {/* Center: Blocks / PDF / Mindmap tabs */}
          <Panel defaultSize={52} minSize={30}>
            <div className="h-full flex flex-col bg-muted/30">
              <Tabs value={activeView} onValueChange={(v) => setActiveView(v as "blocks" | "pdf" | "mindmap")} className="flex-1 flex flex-col min-h-0">
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

                <TabsContent value="blocks" className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden">
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

                <TabsContent value="pdf" className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden">
                  <PdfViewer
                    fileData={fileData}
                    fileName={fileName}
                    onTextSelect={onTextSelect}
                    onImageSelect={onImageSelect}
                    highlightToken={highlightToken}
                  />
                </TabsContent>

                <TabsContent value="mindmap" className="flex-1 mt-0 min-h-0 data-[state=inactive]:hidden">
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
