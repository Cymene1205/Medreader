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
  const [paperId, setPaperId] = useState<string | null>(null);

  const [outline, setOutline] = useState<Outline | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");

  const [selectedText, setSelectedText] = useState<string>("");
  const [selectionNonce, setSelectionNonce] = useState(0);

  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [highlightToken, setHighlightToken] = useState<HighlightToken | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | undefined>();
  const [activeView, setActiveView] = useState<"pdf" | "mindmap">("pdf");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setAttachedImage(null);
    setUploadStage("uploading");

    // Upload to server for parsing + persistence (Feature 3)
    let serverPaperId: string | null = null;
    let serverParsedText: string | null = null;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (upRes.ok) {
        const upData = await upRes.json();
        serverPaperId = upData.paperId;
        setPaperId(upData.paperId);
        setUploadStage("parsing");
        // Poll for parse status
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const sRes = await fetch(`/api/paper/${upData.paperId}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData.parseStatus === "done") {
              serverParsedText = sData.parsedText;
              break;
            }
            if (sData.parseStatus === "error") break;
          }
        }
      }
    } catch (e) {
      // server upload failed; fallback to client extraction
    }

    // Use server-parsed text if available; otherwise client extraction
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
    setPaperText(full);

    // Trigger analysis
    setUploadStage("analyzing");
    setOutlineLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: full,
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

  const onTextSelect = useCallback((text: string) => {
    setSelectedText(text);
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
      // Auto-switch to PDF view so the highlight is visible
      setActiveView("pdf");
    },
    []
  );

  const stageLabel: Record<UploadStage, string> = {
    idle: "",
    uploading: "上传中…",
    parsing: "服务端解析中…",
    analyzing: "AI 分析中…",
    done: "分析完成",
  };

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
            深度文献阅读助手
          </span>
        </div>

        <div className="flex-1" />

        {/* Upload stage indicator */}
        {uploadStage !== "idle" && uploadStage !== "done" && (
          <span className="text-[11px] opacity-80 flex items-center gap-1.5 mr-2">
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
          disabled={outlineLoading || uploadStage === "uploading" || uploadStage === "parsing"}
        >
          {outlineLoading || uploadStage === "uploading" || uploadStage === "parsing" ? (
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

          {/* Center: PDF / Mindmap tabs */}
          <Panel defaultSize={52} minSize={30}>
            <div className="h-full flex flex-col bg-muted/30">
              <Tabs value={activeView} onValueChange={(v) => setActiveView(v as "pdf" | "mindmap")} className="flex-1 flex flex-col min-h-0">
                <div className="border-b bg-background/80 backdrop-blur-sm px-3 py-1.5 flex items-center gap-2">
                  <TabsList className="h-8">
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
                    paperText={paperText}
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
            <span>大纲生成失败：{outlineError}</span>
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
