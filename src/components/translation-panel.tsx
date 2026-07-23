"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Languages, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type TranslateEntry = {
  id: number;
  source: string;
  target: string;
  ts: number;
};

type Props = {
  selectedText: string;
  // bump nonce when a new selection happens (even if same string)
  selectionNonce: number;
};

export default function TranslationPanel({ selectedText, selectionNonce }: Props) {
  const [entries, setEntries] = useState<TranslateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(0);
  const lastNonceRef = useRef(0);

  useEffect(() => {
    if (!selectedText || selectionNonce === lastNonceRef.current) return;
    lastNonceRef.current = selectionNonce;
    if (selectedText.length < 2) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: selectedText, target: "中文" }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (cancelled) return;
        const id = ++idRef.current;
        setEntries((prev) => [
          { id, source: selectedText, target: data.translation, ts: Date.now() },
          ...prev,
        ]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedText, selectionNonce]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-2.5 border-b flex items-center gap-2">
        <Languages className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">翻译</span>
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

      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="p-3 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-md bg-muted/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              正在翻译选中片段…
            </div>
          )}
          {error && (
            <div className="text-xs text-red-500 p-3 rounded-md bg-red-50 dark:bg-red-950/30">
              翻译失败：{error}
            </div>
          )}
          {!loading && entries.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/70 gap-2 text-center px-4">
              <Languages className="h-6 w-6 opacity-30" />
              <p className="text-xs">在 PDF 中选中文字，自动翻译为中文</p>
            </div>
          )}
          {entries.map((e) => (
            <div key={e.id} className="rounded-md border p-2.5 space-y-2">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1">
                  原文
                </div>
                <div className="text-[12px] text-foreground/80 leading-relaxed max-h-24 overflow-y-auto scrollbar-thin">
                  {e.source}
                </div>
              </div>
              <div className="h-px bg-border/60" />
              <div>
                <div className="text-[10px] uppercase text-primary tracking-wide mb-1">
                  译文
                </div>
                <div className="text-[13px] leading-relaxed">{e.target}</div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
