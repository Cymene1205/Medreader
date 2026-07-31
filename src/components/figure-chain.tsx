"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ChevronRight, Image as ImageIcon, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

/**
 * Figure chain — the visual narrative of figures strung along a vertical
 * line, displayed inside the "论证主线" section of the new 全文框架 panel.
 *
 * Each Figure card represents one main figure, ordered by `chainIndex`
 * (the document order of its first in-text citation). Cards can be
 * expanded to show panel-level analysis from Call B (/api/figure-detail).
 *
 * Card visual encoding:
 *   - Left vertical line (2px, light gray) running through all cards
 *   - Each card has a "dot" sitting on the line, coloured by role:
 *       铺垫    → gray
 *       关键证据 → primary (blue)
 *       验证    → teal
 *       延伸    → purple
 *   - isLinchpin figures get a solid rose dot + "命门" pill next to label
 *   - Question text prefixed with "Q" in primary color
 *
 * Card expanded state (mutually exclusive — only one card open at a time):
 *   - Logic closure bar (dark primary background, white text)
 *   - Layer list (1-4 layers, each defaults to collapsed)
 *     · Each layer header: numbered color block + title + panel range pill
 *     · Click header to expand: shows purpose + panel details + conclusion
 *   - Bridge card (dashed border, "承上启下")
 *   - Button row: "跳到原图 p.N" (primary filled) + "查看图注" (ghost)
 *
 * Panel chip click: uses citationsJson to find the matching citation's
 * sentence (truncated to 10-30 chars) as the quote for jump-highlight.
 */

// ── Types (mirror Prisma Figure model + analysisJson shapes) ─────────────

export type Figure = {
  id: string;
  paperId: string;
  label: string;
  caption: string;
  imagePath: string | null;
  pageIndex: number;
  order: number;
  panelCount: number;
  question: string | null;
  method: string | null;
  role: string | null; // "铺垫" | "关键证据" | "验证" | "延伸"
  isLinchpin: boolean;
  chainIndex: number | null;
  detailJson: string | null;
  detailStatus: string; // "none" | "pending" | "done" | "error"
  createdAt: string;
};

export type FigureDetail = {
  question?: string;
  closure: string;
  layers: Array<{
    title: string;
    panels: string[];
    purpose: string;
    panelDetails: Array<{
      panel: string;
      text: string;
      relation?: string;
    }>;
    conclusion: string;
  }>;
  bridge: string;
};

export type Citation = {
  figureLabel: string;
  panels: string[];
  sentence: string;
  pageIndex: number;
  isSupp: boolean;
};

// ── Role → color mapping ──────────────────────────────────────────────────

const ROLE_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  铺垫: { dot: "#94A3B8", bg: "bg-slate-100 dark:bg-slate-900/40", text: "text-slate-600 dark:text-slate-400" },
  关键证据: { dot: "#2563EB", bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-600 dark:text-blue-400" },
  验证: { dot: "#0D9488", bg: "bg-teal-100 dark:bg-teal-900/40", text: "text-teal-600 dark:text-teal-400" },
  延伸: { dot: "#9333EA", bg: "bg-purple-100 dark:bg-purple-900/40", text: "text-purple-600 dark:text-purple-400" },
};

const LAYER_COLORS = ["#2563EB", "#0D9488", "#9333EA", "#EA580C"];

function roleStyle(role: string | null) {
  return ROLE_COLORS[role || ""] || ROLE_COLORS["铺垫"];
}

// ── Props ──────────────────────────────────────────────────────────────────

type Props = {
  paperId: string | null;
  figures: Figure[];
  citations: Citation[];
  onPanelChipClick: (quote: string, pageIndex: number) => void;
  onJumpToPage: (pageIndex: number) => void;
};

export default function FigureChain({
  paperId,
  figures,
  citations,
  onPanelChipClick,
  onJumpToPage,
}: Props) {
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({});
  const [detailCache, setDetailCache] = useState<Record<string, FigureDetail | null>>({});
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [errorLabel, setErrorLabel] = useState<string | null>(null);
  const [captionDialogFigure, setCaptionDialogFigure] = useState<Figure | null>(null);
  const fetchedRef = useRef<Set<string>>(new Set());

  // Sort figures by chainIndex (nulls last)
  const sortedFigures = [...figures].sort((a, b) => {
    if (a.chainIndex == null && b.chainIndex == null) return a.order - b.order;
    if (a.chainIndex == null) return 1;
    if (b.chainIndex == null) return -1;
    return a.chainIndex - b.chainIndex;
  });

  const totalChains = sortedFigures.filter((f) => f.chainIndex != null).length;

  // Auto-fetch detail when a card is expanded (if detailStatus is none/error)
  const fetchDetail = useCallback(
    async (figure: Figure) => {
      if (!paperId) return;
      if (figure.detailStatus === "done" && figure.detailJson) {
        try {
          setDetailCache((c) => ({
            ...c,
            [figure.label]: JSON.parse(figure.detailJson!) as FigureDetail,
          }));
        } catch {
          // ignore parse error
        }
        return;
      }
      if (loadingLabel === figure.label) return;

      setLoadingLabel(figure.label);
      setErrorLabel(null);
      try {
        const res = await fetch("/api/figure-detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paperId, figureLabel: figure.label }),
        });
        if (res.status === 409) {
          // Another call in-flight — poll for completion
          setTimeout(() => fetchDetail(figure), 2000);
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setDetailCache((c) => ({ ...c, [figure.label]: data.detail as FigureDetail }));
      } catch (e) {
        setErrorLabel(figure.label);
        console.warn(`[figure-chain] fetch detail failed for ${figure.label}:`, e);
      } finally {
        setLoadingLabel(null);
      }
    },
    [paperId, loadingLabel]
  );

  // When a card expands, trigger fetch if needed
  useEffect(() => {
    if (!expandedLabel) return;
    const fig = sortedFigures.find((f) => f.label === expandedLabel);
    if (!fig) return;
    if (fig.detailStatus === "done" && detailCache[fig.label]) return;
    if (fetchedRef.current.has(expandedLabel)) return;
    fetchedRef.current.add(expandedLabel);
    fetchDetail(fig);
  }, [expandedLabel, sortedFigures, detailCache, fetchDetail]);

  const toggleExpand = (label: string) => {
    setExpandedLabel((cur) => (cur === label ? null : label));
    setExpandedLayers({});
  };

  // Find citation sentences for a specific panel of a figure
  const findPanelQuote = useCallback(
    (figureLabel: string, panel: string): { quote: string; pageIndex: number } | null => {
      const matches = citations.filter(
        (c) =>
          c.figureLabel === figureLabel &&
          !c.isSupp &&
          (c.panels.length === 0 || c.panels.includes(panel))
      );
      if (matches.length === 0) return null;
      const m = matches[0];
      const quote = m.sentence.slice(0, 60).trim();
      return { quote, pageIndex: m.pageIndex };
    },
    [citations]
  );

  if (figures.length === 0) {
    return (
      <div className="text-center py-6 px-3 text-muted-foreground">
        <AlertCircle className="h-4 w-4 mx-auto mb-1.5 opacity-50" />
        <p className="text-[11px]">当前解析模式不支持图表导航</p>
        <p className="text-[10px] mt-1 text-muted-foreground/70">
          论证主线仍可显示，但无图锚点
        </p>
      </div>
    );
  }

  return (
    <div className="relative pl-5 pr-2 py-2">
      {/* Vertical line on the left */}
      <div
        className="absolute left-[6px] top-3 bottom-3 w-[2px] bg-border/60"
        aria-hidden
      />

      <div className="space-y-2">
        {sortedFigures.map((fig) => {
          const style = roleStyle(fig.role);
          const isExpanded = expandedLabel === fig.label;
          const detail = detailCache[fig.label];
          const isLoading = loadingLabel === fig.label;
          const hasError = errorLabel === fig.label;
          const chainPos = fig.chainIndex ? `第 ${fig.chainIndex} 环` : "未入链";
          const panelsRange = fig.panelCount > 0 ? `A–${String.fromCharCode(64 + fig.panelCount)}` : "";

          return (
            <div key={fig.id} className="relative">
              {/* Dot on the line */}
              <div
                className="absolute left-[-18px] top-3 w-[10px] h-[10px] rounded-full border-2 border-background"
                style={{
                  background: fig.isLinchpin ? "#E11D48" : style.dot,
                  boxShadow: fig.isLinchpin ? "0 0 0 3px rgba(225, 29, 72, 0.2)" : "none",
                }}
                aria-hidden
              />

              {/* Card */}
              <div
                className={cn(
                  "rounded-md border bg-card shadow-sm transition-all",
                  isExpanded ? "border-primary/40 shadow-md" : "border-border/60 hover:border-border",
                  fig.isLinchpin && "ring-1 ring-rose-300/50"
                )}
              >
                {/* Header (always visible) */}
                <button
                  type="button"
                  onClick={() => toggleExpand(fig.label)}
                  className="w-full text-left px-2.5 py-2 flex items-start gap-2"
                >
                  <div className="flex-1 min-w-0">
                    {/* Label + badges row */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      <span className="text-[12px] font-bold text-foreground">
                        {fig.label}
                      </span>
                      {fig.isLinchpin && (
                        <span className="px-1 py-px rounded text-[9px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                          命门
                        </span>
                      )}
                      {fig.method && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] h-3.5 px-1 py-0 font-medium"
                        >
                          {fig.method}
                        </Badge>
                      )}
                      {panelsRange && (
                        <span className="text-[9px] text-muted-foreground">
                          panels {panelsRange}
                        </span>
                      )}
                    </div>
                    {/* Question */}
                    {fig.question ? (
                      <div className="flex items-start gap-1 text-[12px] leading-snug text-foreground/90">
                        <span className="text-primary font-bold flex-shrink-0">Q</span>
                        <span className="flex-1">{fig.question}</span>
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted-foreground/80 italic line-clamp-2">
                        {fig.caption.slice(0, 80)}
                        {fig.caption.length > 80 ? "…" : ""}
                      </div>
                    )}
                    {/* Meta row */}
                    <div className="text-[9px] text-muted-foreground/70 mt-1 flex items-center gap-2">
                      <span>p.{fig.pageIndex}</span>
                      <span>·</span>
                      <span>{chainPos}{totalChains > 0 ? ` · 共 ${totalChains} 环` : ""}</span>
                      <span>·</span>
                      <span className={style.text}>{fig.role || "未分类"}</span>
                    </div>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1 transition-transform",
                      isExpanded && "rotate-90"
                    )}
                  />
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-2.5 pb-2.5 pt-0 space-y-2.5 border-t border-border/40 mt-1">
                    {isLoading && (
                      <div className="flex items-center justify-center py-6 text-muted-foreground gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span className="text-[11px]">正在生成层级化解析…</span>
                      </div>
                    )}

                    {hasError && !isLoading && (
                      <div className="text-center py-4 text-muted-foreground">
                        <AlertCircle className="h-4 w-4 mx-auto mb-1 text-amber-500" />
                        <p className="text-[11px] mb-1.5">生成失败</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px]"
                          onClick={() => {
                            fetchedRef.current.delete(fig.label);
                            setErrorLabel(null);
                            fetchDetail(fig);
                          }}
                        >
                          重试
                        </Button>
                      </div>
                    )}

                    {detail && !isLoading && !hasError && (
                      <>
                        {/* Closure bar */}
                        <div className="rounded bg-primary text-primary-foreground px-2 py-1.5 relative">
                          <div className="text-[9px] opacity-70 mb-0.5">逻辑闭环</div>
                          <div className="text-[11px] font-medium leading-snug">
                            {detail.closure}
                          </div>
                        </div>

                        {/* Layers */}
                        {detail.layers.map((layer, idx) => {
                          const layerColor = LAYER_COLORS[idx % LAYER_COLORS.length];
                          const layerKey = `${fig.label}-L${idx}`;
                          const isLayerExpanded = expandedLayers[layerKey];
                          const panelsLabel = layer.panels.length > 0 ? layer.panels.join("") : "?";

                          return (
                            <div
                              key={layerKey}
                              className="rounded border border-border/60 bg-muted/30 overflow-hidden"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedLayers((cur) => ({
                                    ...cur,
                                    [layerKey]: !cur[layerKey],
                                  }))
                                }
                                className="w-full px-2 py-1.5 flex items-center gap-1.5 text-left hover:bg-muted/60"
                              >
                                <span
                                  className="flex-shrink-0 w-4 h-4 rounded text-[9px] font-bold text-white flex items-center justify-center"
                                  style={{ background: layerColor }}
                                >
                                  {idx + 1}
                                </span>
                                <span className="text-[11px] font-medium flex-1 truncate">
                                  {layer.title}
                                </span>
                                <span
                                  className="px-1 py-px rounded text-[8px] font-mono"
                                  style={{
                                    background: `${layerColor}20`,
                                    color: layerColor,
                                  }}
                                >
                                  {panelsLabel}
                                </span>
                                <ChevronRight
                                  className={cn(
                                    "h-3 w-3 text-muted-foreground flex-shrink-0 transition-transform",
                                    isLayerExpanded && "rotate-90"
                                  )}
                                />
                              </button>

                              {/* Layer conclusion (always visible) */}
                              {!isLayerExpanded && (
                                <div
                                  className="px-2 pb-1.5 pl-7 text-[10px] leading-snug"
                                  style={{ color: layerColor }}
                                >
                                  {layer.conclusion}
                                </div>
                              )}

                              {/* Expanded layer detail */}
                              {isLayerExpanded && (
                                <div className="px-2 pb-2 pl-7 space-y-1.5">
                                  <div className="border-l-2 pl-2 text-[10.5px] text-muted-foreground leading-relaxed">
                                    {layer.purpose}
                                  </div>
                                  {layer.panelDetails.map((pd, i) => {
                                    const quote = findPanelQuote(fig.label, pd.panel);
                                    return (
                                      <button
                                        key={i}
                                        type="button"
                                        onClick={() => {
                                          if (quote) {
                                            onPanelChipClick(quote.quote, quote.pageIndex);
                                          } else {
                                            onJumpToPage(fig.pageIndex);
                                          }
                                        }}
                                        className="w-full text-left flex items-start gap-1.5 hover:bg-muted/60 rounded px-1 py-0.5"
                                      >
                                        <span
                                          className="flex-shrink-0 w-4 h-4 rounded text-[9px] font-mono font-bold text-white flex items-center justify-center mt-0.5"
                                          style={{ background: layerColor }}
                                        >
                                          {pd.panel}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-[10.5px] leading-snug text-foreground/80">
                                            {pd.text}
                                          </div>
                                          {pd.relation && (
                                            <span className="inline-block mt-0.5 px-1 py-px rounded text-[8px] bg-muted text-muted-foreground">
                                              {pd.relation}
                                            </span>
                                          )}
                                        </div>
                                      </button>
                                    );
                                  })}
                                  <div
                                    className="text-[10.5px] font-medium pt-0.5"
                                    style={{ color: layerColor }}
                                  >
                                    {layer.conclusion}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Bridge */}
                        <div className="rounded border border-dashed border-border/60 px-2 py-1.5 bg-muted/20">
                          <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-0.5">
                            承上启下
                          </div>
                          <div className="text-[10.5px] leading-snug text-foreground/80">
                            {detail.bridge}
                          </div>
                        </div>

                        {/* Buttons */}
                        <div className="flex gap-1.5 pt-0.5">
                          <Button
                            size="sm"
                            className="h-7 text-[10px] flex-1"
                            onClick={() => onJumpToPage(fig.pageIndex)}
                          >
                            跳到原图 p.{fig.pageIndex}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[10px] flex-1"
                            onClick={() => setCaptionDialogFigure(fig)}
                          >
                            <ImageIcon className="h-3 w-3 mr-1" />
                            查看图注
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Caption Dialog — shows the figure image + full caption */}
      <Dialog
        open={!!captionDialogFigure}
        onOpenChange={(o) => !o && setCaptionDialogFigure(null)}
      >
        <DialogContent className="w-[80%] max-w-[1000px] max-h-[85vh] flex flex-col p-0 gap-0">
          {captionDialogFigure && (
            <>
              <DialogHeader className="px-4 py-3 border-b">
                <DialogTitle className="text-base">
                  {captionDialogFigure.label}
                  {captionDialogFigure.isLinchpin && (
                    <span className="ml-2 px-1.5 py-px rounded text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                      命门
                    </span>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {captionDialogFigure.imagePath && (
                  <div className="bg-muted/30 p-3 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/figure-image/${captionDialogFigure.id}`}
                      alt={captionDialogFigure.label}
                      className="max-w-full max-h-[60vh] object-contain rounded shadow-sm"
                    />
                  </div>
                )}
                <div className="px-4 py-3 text-[12px] leading-relaxed text-foreground/85">
                  {captionDialogFigure.caption}
                </div>
                {captionDialogFigure.question && (
                  <div className="mx-4 mb-3 px-3 py-2 rounded bg-primary/5 border-l-2 border-primary/40 text-[11.5px]">
                    <span className="text-primary font-bold mr-1">Q</span>
                    {captionDialogFigure.question}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
