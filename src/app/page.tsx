"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PdfViewer from "@/components/pdf-viewer";
import OutlinePanel, {
  type Outline,
  type OutlineChild,
  type OutlineSection,
} from "@/components/outline-panel";
import TranslationPanel from "@/components/translation-panel";
import ChatPanel from "@/components/chat-panel";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Loader2,
  BookOpen,
  Github,
  Info,
} from "lucide-react";

type HighlightToken = {
  quote: string;
  keywords: string[];
  nonce: number;
};

export default function Home() {
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [paperText, setPaperText] = useState<string>("");

  const [outline, setOutline] = useState<Outline | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);

  const [selectedText, setSelectedText] = useState<string>("");
  const [selectionNonce, setSelectionNonce] = useState(0);

  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [highlightToken, setHighlightToken] = useState<HighlightToken | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("目前仅支持 PDF 格式");
      return;
    }
    const buf = await file.arrayBuffer();
    // Make a COPY for the parent's text extraction so the worker transfer
    // in PdfViewer doesn't detach the shared ArrayBuffer.
    const bufForText = buf.slice(0);
    setFileData(buf);
    setFileName(file.name);
    setOutline(null);
    setOutlineError(null);
    setSelectedText("");
    setAttachedImage(null);

    // Extract text for analysis using pdfjs (client side)
    try {
      const lib = await import("pdfjs-dist");
      lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`;
      const doc = await lib.getDocument({ data: new Uint8Array(bufForText) }).promise;
      let full = "";
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        const pageText = tc.items
          .map((it: any) => (typeof it.str === "string" ? it.str : ""))
          .join(" ");
        full += `\n[Page ${i}]\n${pageText}\n`;
        page.cleanup();
      }
      setPaperText(full);

      // Trigger analysis
      setOutlineLoading(true);
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: full, title: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOutline(data.outline);
    } catch (e) {
      setOutlineError(e instanceof Error ? e.message : String(e));
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
    },
    []
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-muted/30 overflow-hidden">
      {/* Header */}
      <header className="h-12 flex-shrink-0 bg-background border-b flex items-center px-4 gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <BookOpen className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm">MedReader Agent</span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            深度文献阅读助手
          </span>
        </div>

        <div className="flex-1" />

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
          className="h-8 gap-1.5"
          disabled={outlineLoading}
        >
          {outlineLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          导入 PDF
        </Button>
      </header>

      {/* 5-panel layout: outline | pdf | (translation / chat) */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: Outline */}
        <aside className="w-[260px] flex-shrink-0 border-r bg-background hidden md:block">
          <OutlinePanel
            outline={outline}
            loading={outlineLoading}
            onChildClick={onChildClick}
            activeChildId={activeChildId}
          />
        </aside>

        {/* Center: PDF */}
        <main className="flex-1 min-w-0 min-h-0">
          <PdfViewer
            fileData={fileData}
            fileName={fileName}
            onTextSelect={onTextSelect}
            onImageSelect={onImageSelect}
            highlightToken={highlightToken}
          />
        </main>

        {/* Right: translation (top) + chat (bottom) */}
        <aside className="w-[380px] flex-shrink-0 border-l bg-background hidden lg:flex flex-col">
          <div className="h-[42%] min-h-0 border-b">
            <TranslationPanel
              selectedText={selectedText}
              selectionNonce={selectionNonce}
            />
          </div>
          <div className="flex-1 min-h-0">
            <ChatPanel
              attachedImage={attachedImage}
              onClearAttachedImage={() => setAttachedImage(null)}
              selectedText={selectedText}
              paperText={paperText}
            />
          </div>
        </aside>
      </div>

      {/* Outline error toast */}
      {outlineError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[600px]">
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs px-4 py-2.5 rounded-md shadow-lg flex items-center gap-2">
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
