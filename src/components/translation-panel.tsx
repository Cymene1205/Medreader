"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Languages, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type TranslateEntry = {
  id: number;
  source: string; // kept for traceability, but not displayed
  target: string;
  ts: number;
  loading: boolean;
  error?: string;
};

type Props = {
  /** Paragraph text from BlockReader single-click, or selection from PDF viewer. */
  selectedText: string;
  /** Block index (from BlockReader) — for display, optional. */
  selectedBlockIdx?: number | null;
  // bump nonce when a new selection happens (even if same string)
  selectionNonce: number;
  /** LLM headers from LLMSettingsDialog — attached to translate API call */
  llmHeaders?: Record<string, string>;
};

export default function TranslationPanel({
  selectedText,
  selectedBlockIdx,
  selectionNonce,
  llmHeaders = {},
}: Props) {
  const [entries, setEntries] = useState<TranslateEntry[]>([]);
  const idRef = useRef(0);
  const lastNonceRef = useRef(0);
  const headersRef = useRef(llmHeaders);
  headersRef.current = llmHeaders;

  useEffect(() => {
    if (!selectedText || selectionNonce === lastNonceRef.current) return;
    lastNonceRef.current = selectionNonce;
    if (selectedText.length < 2) return;

    const id = ++idRef.current;
    // Optimistic: show entry with loading state immediately
    setEntries((prev) => [
      {
        id,
        source: selectedText,
        target: "",
        ts: Date.now(),
        loading: true,
      },
      ...prev,
    ]);

    (async () => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headersRef.current },
          body: JSON.stringify({ text: selectedText, target: "中文" }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, target: data.translation, loading: false } : e))
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, loading: false, error: msg } : e))
        );
      }
    })();
  }, [selectedText, selectionNonce]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-2.5 border-b flex items-center gap-2">
        <Languages className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">翻译</span>
        <span className="text-[10px] text-muted-foreground/70 ml-1 hidden sm:inline">
          点中间段落自动翻译
        </span>
        {entries.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 w-6 p-0"
            onClick={() => setEntries([])}
            title="清空"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="p-3 space-y-2.5">
          {!entries.length && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/70 gap-2 text-center px-4">
              <Languages className="h-6 w-6 opacity-30" />
              <p className="text-xs">点击中间区域的段落</p>
              <p className="text-[10px]">或在「原文 PDF」Tab 中选中文字，自动翻译为中文</p>
              <p className="text-[10px] text-muted-foreground/60 mt-2">
                翻译历史会保留在此面板，可上下滚动
              </p>
            </div>
          )}
          {entries.map((e, idx) => (
            <div
              key={e.id}
              className="rounded-md border p-3 bg-card relative"
            >
              {/* Counter badge (newest = 1) */}
              <div className="absolute top-2 right-2 text-[9px] text-muted-foreground/50">
                #{entries.length - idx}
              </div>

              {e.loading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  翻译中…
                </div>
              ) : e.error ? (
                <div className="text-xs text-red-500 leading-relaxed">
                  翻译失败：{e.error}
                </div>
              ) : (
                <div className="text-[13.5px] leading-[1.8] text-foreground/90">
                  {e.target}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
