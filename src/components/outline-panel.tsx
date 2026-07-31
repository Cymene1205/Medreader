"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  LayoutGrid,
  FileSearch,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import FigureChain, {
  type Figure,
  type FigureDetail,
  type Citation,
} from "@/components/figure-chain";

// ── Types: new 4-layer analysis JSON shape (matches lib/analyze-stage2.ts) ──

export type AnalysisJson = {
  title: string;
  questionBackground: { summary: string; detail: string } | null;
  argumentSpine: { summary: string; linchpinFigure: string | null } | null;
  novelty: { summary: string; detail: string } | null;
  limitsOpportunities: {
    summary: string;
    detail: string;
    pairs: Array<{ limitation: string; opportunity: string }>;
  } | null;
  failedParts: string[];
};

// ── Legacy types preserved for backward compat with page.tsx ──────────────
// page.tsx imports OutlineChild/OutlineSection/StructuredHeading from this
// file — we keep them so the import doesn't break. They're unused by the
// new rendering code but still referenced by the old onChildClick signature.

export type OutlineChild = {
  id: string;
  title: string;
  summary?: string;
  keywords?: string[];
  quote?: string;
};

export type OutlineSection = {
  id: string;
  title: string;
  summary?: string;
  detail?: string;
  keyPoints?: string[];
  quote?: string;
  children: OutlineChild[];
};

export type PaperHeading = {
  level: number;
  text: string;
  origText?: string;
};

export type StructuredHeadingChild = {
  title: string;
  origTitle: string;
};

export type StructuredHeading = {
  title: string;
  origTitle: string;
  kind: "major" | "metadata";
  children: StructuredHeadingChild[];
};

export type Outline = AnalysisJson & {
  // Legacy fields (kept for backward compat; new code ignores them)
  sections?: OutlineSection[];
  structuredHeadings?: StructuredHeading[];
};

// ── Props ──────────────────────────────────────────────────────────────────

type Props = {
  outline: Outline | null;
  loading: boolean;
  /** Legacy — kept because page.tsx still passes it. Unused in new render. */
  onChildClick?: (child: OutlineChild, section: OutlineSection) => void;
  activeChildId?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;

  /** New: paperId — needed to fetch figures + retry failed parts. */
  paperId?: string | null;
  /** New: figures list (passed from parent, which polls /api/figures) */
  figures?: Figure[];
  /** New: citations list (passed from parent) */
  citations?: Citation[];
  /** New: callbacks for figure interactions */
  onPanelChipClick?: (quote: string, pageIndex: number) => void;
  onJumpToPage?: (pageIndex: number) => void;
  /**
   * Stage 2 progress signal from the parent. Indicates where the figures /
   * argumentSpine pipeline currently is so we can show a progress indicator
   * in the 论证主线 section. Possible values:
   *   - "idle"        : no paper loaded
   *   - "extracting"  : MinerU figure extraction done, Call A not yet triggered
   *   - "call-a"      : Call A LLM (batch analyse all figures) in flight
   *   - "spine"       : Call A done, argumentSpine generation in flight
   *   - "done"        : Stage 2 complete — figures + spine both ready
   *   - "error"       : Call A or spine failed
   */
  figuresStatus?: "idle" | "extracting" | "call-a" | "spine" | "done" | "error";
};

// ── Section config: which parts exist + their display metadata ────────────

type SectionKey = "questionBackground" | "argumentSpine" | "novelty" | "limitsOpportunities";

const SECTIONS: Array<{
  key: SectionKey;
  index: number;
  title: string;
  color: string;
}> = [
  { key: "questionBackground", index: 1, title: "问题与背景", color: "#2563EB" },
  { key: "argumentSpine", index: 2, title: "论证主线", color: "#0D9488" },
  { key: "novelty", index: 3, title: "创新性", color: "#9333EA" },
  { key: "limitsOpportunities", index: 4, title: "局限与机会", color: "#EA580C" },
];

// ── Main component ─────────────────────────────────────────────────────────

export default function OutlinePanel({
  outline,
  loading,
  collapsed = false,
  onCollapsedChange,
  paperId,
  figures = [],
  citations = [],
  onPanelChipClick,
  onJumpToPage,
  figuresStatus = "idle",
}: Props) {
  const [openItems, setOpenItems] = useState<string[]>(["argumentSpine"]); // 论证主线 default open
  const [retrying, setRetrying] = useState<string | null>(null);

  const fs = (px: number) => `${px}px`;

  // Retry a failed part
  const retryPart = useCallback(
    async (part: string) => {
      if (!paperId) return;
      setRetrying(part);
      try {
        const res = await fetch(`/api/analyze?part=${part}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paperId }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${res.status}`);
        }
        // Trigger parent refresh — parent will re-fetch analysisJson
        window.dispatchEvent(new CustomEvent("medreader:analysis-updated"));
      } catch (e) {
        console.warn(`[outline-panel] retry ${part} failed:`, e);
      } finally {
        setRetrying(null);
      }
    },
    [paperId]
  );

  const toggleItem = (key: string) => {
    setOpenItems((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    );
  };

  // ── Header (always rendered) ────────────────────────────────────────────
  return (
    <div className={cn("flex flex-col bg-card", collapsed ? "h-auto" : "h-full")}>
      <button
        type="button"
        onClick={() => onCollapsedChange?.(!collapsed)}
        className={cn(
          "w-full px-3 py-2 flex items-center gap-2 text-left transition-colors flex-shrink-0",
          "hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30",
          "border-b border-emerald-100/70 dark:border-emerald-900/40"
        )}
        title={collapsed ? "展开全文框架" : "折叠全文框架"}
        aria-label={collapsed ? "展开全文框架" : "折叠全文框架"}
        aria-expanded={!collapsed}
      >
        <LayoutGrid className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <span className="text-[12px] font-semibold flex-1 text-emerald-700 dark:text-emerald-300">
          全文框架
        </span>
        {outline && (
          <Badge
            variant="secondary"
            className="text-[10px] h-4 px-1.5 bg-emerald-100/70 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          >
            4 层
          </Badge>
        )}
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform flex-shrink-0",
            !collapsed && "rotate-90"
          )}
        />
      </button>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <div className="p-2">
            {loading && !outline && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-xs">Agent 正在分析文献…</p>
                <p className="text-[10px] text-muted-foreground/70">
                  生成 4 层结构化分析（约 15-30 秒）
                </p>
              </div>
            )}

            {!loading && !outline && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/70 gap-2 px-4 text-center">
                <FileSearch className="h-6 w-6 opacity-40" />
                <p className="text-xs">导入 PDF 后，Agent 将自动生成分析</p>
                <p className="text-[10px]">
                  4 层结构：问题与背景 · 论证主线 · 创新性 · 局限与机会
                </p>
              </div>
            )}

            {outline && (
              <div className="space-y-1.5">
                {SECTIONS.map((sec) => {
                  const part = outline[sec.key];
                  const isOpen = openItems.includes(sec.key);
                  const isFailed = outline.failedParts?.includes(sec.key);
                  const isRetrying = retrying === sec.key;
                  // 论证主线 default expanded and can't be collapsed
                  const isAlwaysOpen = sec.key === "argumentSpine";

                  // Determine if section has content
                  const hasContent = (() => {
                    if (sec.key === "argumentSpine") {
                      return outline.argumentSpine?.summary || figures.length > 0;
                    }
                    if (sec.key === "limitsOpportunities") {
                      return outline.limitsOpportunities?.summary;
                    }
                    return part && (part as any).summary;
                  })();

                  return (
                    <div
                      key={sec.key}
                      className={cn(
                        "rounded-md border bg-card shadow-sm transition-all",
                        isOpen ? "border-border" : "border-border/60"
                      )}
                      style={{
                        borderLeft: `3px solid ${sec.color}`,
                      }}
                    >
                      {/* Header */}
                      <button
                        type="button"
                        onClick={() => !isAlwaysOpen && toggleItem(sec.key)}
                        className={cn(
                          "w-full text-left px-2.5 py-2 flex items-start gap-2",
                          !isAlwaysOpen && "hover:bg-muted/40"
                        )}
                      >
                        <span
                          className="flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center mt-0.5"
                          style={{ background: sec.color }}
                        >
                          {sec.index}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-medium leading-snug"
                            style={{ fontSize: fs(13) }}
                          >
                            {sec.title}
                          </div>
                          {hasContent && (part as any)?.summary && (
                            <div
                              className="text-muted-foreground mt-0.5 line-clamp-2"
                              style={{ fontSize: fs(11) }}
                            >
                              {(part as any).summary}
                            </div>
                          )}
                          {!hasContent && !isFailed && sec.key !== "argumentSpine" && (
                            <div
                              className="text-muted-foreground/60 mt-0.5 italic"
                              style={{ fontSize: fs(11) }}
                            >
                              正在生成…
                            </div>
                          )}
                          {!hasContent && !isFailed && sec.key === "argumentSpine" && (
                            <ArgumentSpineProgress
                              figuresStatus={figuresStatus}
                              figuresCount={figures.length}
                              hasSpine={!!outline.argumentSpine?.summary}
                            />
                          )}
                          {isFailed && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="text-[10px] text-amber-600 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" />
                                生成失败
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-5 text-[9px] px-1.5 py-0"
                                disabled={isRetrying}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryPart(sec.key);
                                }}
                              >
                                {isRetrying ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin mr-0.5" />
                                ) : (
                                  <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                                )}
                                重试
                              </Button>
                            </div>
                          )}
                        </div>
                        {!isAlwaysOpen && (
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1 transition-transform",
                              isOpen && "rotate-90"
                            )}
                          />
                        )}
                      </button>

                      {/* Body */}
                      {(isOpen || isAlwaysOpen) && (
                        <div className="px-2.5 pb-2.5 pt-0 space-y-2">
                          {/* ArgumentSpine: special rendering — summary + figure chain */}
                          {sec.key === "argumentSpine" && (
                            <>
                              {outline.argumentSpine?.summary && (
                                <div className="rounded bg-muted/40 px-2.5 py-2 text-[11.5px] leading-relaxed text-foreground/85">
                                  {outline.argumentSpine.summary}
                                </div>
                              )}
                              {figures.length > 0 ? (
                                <FigureChain
                                  paperId={paperId || null}
                                  figures={figures}
                                  citations={citations}
                                  onPanelChipClick={onPanelChipClick || (() => {})}
                                  onJumpToPage={onJumpToPage || (() => {})}
                                />
                              ) : (
                                <div className="text-center py-3 text-[10px] text-muted-foreground/60">
                                  {loading
                                    ? "图表分析中…"
                                    : "（无图表数据 — 当前解析模式不支持）"}
                                </div>
                              )}
                            </>
                          )}

                          {/* Standard sections: render Markdown detail */}
                          {sec.key !== "argumentSpine" && part && (part as any).detail && (
                            <div className="chat-markdown text-[12px] leading-[1.7] px-1">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                              >
                                {(part as any).detail}
                              </ReactMarkdown>
                            </div>
                          )}

                          {/* LimitsOpportunities: render pairs explicitly */}
                          {sec.key === "limitsOpportunities" &&
                            outline.limitsOpportunities?.pairs &&
                            outline.limitsOpportunities.pairs.length > 0 && (
                              <div className="space-y-1.5 mt-1">
                                {outline.limitsOpportunities.pairs.map((p, i) => (
                                  <div
                                    key={i}
                                    className="rounded border border-border/60 bg-muted/20 px-2 py-1.5"
                                  >
                                    <div className="text-[11px] flex items-start gap-1.5">
                                      <span className="text-amber-600 font-bold flex-shrink-0">
                                        L{i + 1}
                                      </span>
                                      <span className="flex-1 text-foreground/85">
                                        {p.limitation}
                                      </span>
                                    </div>
                                    <div className="text-[11px] flex items-start gap-1.5 mt-0.5 pl-4">
                                      <span className="text-emerald-600 flex-shrink-0">↳</span>
                                      <span className="flex-1 text-muted-foreground">
                                        {p.opportunity}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Footer note */}
                <div className="text-[10px] text-muted-foreground/50 text-center py-2 px-2">
                  解析均由正文引用句推导 · 点 panel 标签跳转原文验货
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ArgumentSpine progress indicator ──────────────────────────────────────
// Shows the current Stage 2 sub-step inside the 论证主线 card header so the
// user can see why it's "still loading" — figure extraction / Call A / spine
// generation each have their own message and progress dot.

function ArgumentSpineProgress({
  figuresStatus,
  figuresCount,
  hasSpine,
}: {
  figuresStatus: "idle" | "extracting" | "call-a" | "spine" | "done" | "error";
  figuresCount: number;
  hasSpine: boolean;
}) {
  // Steps: 1) 提取图表  2) Call A 批量分析  3) 生成论证主线
  // Each step is one of: done / active / pending
  type StepState = "done" | "active" | "pending";
  const steps: Array<{ key: string; label: string; state: StepState }> = (() => {
    if (figuresStatus === "error") {
      return [
        { key: "extract", label: "提取图表", state: figuresCount > 0 ? "done" : "active" },
        { key: "calla", label: "Call A 分析", state: "pending" },
        { key: "spine", label: "生成主线", state: "pending" },
      ];
    }
    if (hasSpine && figuresStatus === "done") {
      return [
        { key: "extract", label: "提取图表", state: "done" },
        { key: "calla", label: "Call A 分析", state: "done" },
        { key: "spine", label: "生成主线", state: "done" },
      ];
    }
    if (figuresStatus === "spine") {
      return [
        { key: "extract", label: "提取图表", state: "done" },
        { key: "calla", label: "Call A 分析", state: "done" },
        { key: "spine", label: "生成主线", state: "active" },
      ];
    }
    if (figuresStatus === "call-a") {
      return [
        { key: "extract", label: "提取图表", state: "done" },
        { key: "calla", label: "Call A 分析", state: "active" },
        { key: "spine", label: "生成主线", state: "pending" },
      ];
    }
    // idle / extracting
    return [
      { key: "extract", label: "提取图表", state: figuresStatus === "extracting" ? "active" : "pending" },
      { key: "calla", label: "Call A 分析", state: "pending" },
      { key: "spine", label: "生成主线", state: "pending" },
    ];
  })();

  const currentLabel = (() => {
    const active = steps.find((s) => s.state === "active");
    if (active) return active.label + "中…";
    if (figuresStatus === "error") return "生成失败";
    if (steps.every((s) => s.state === "done")) return "完成";
    return "等待中…";
  })();

  return (
    <div className="mt-1.5 space-y-1">
      {/* Step dots */}
      <div className="flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-1">
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full flex-shrink-0",
                s.state === "done" && "bg-emerald-500",
                s.state === "active" && "bg-teal-500 animate-pulse",
                s.state === "pending" && "bg-muted-foreground/30"
              )}
            />
            <span
              className={cn(
                "text-[9.5px] truncate",
                s.state === "done" && "text-emerald-600 dark:text-emerald-400",
                s.state === "active" && "text-teal-600 dark:text-teal-400 font-medium",
                s.state === "pending" && "text-muted-foreground/60"
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-px",
                  s.state === "done" ? "bg-emerald-500/40" : "bg-border"
                )}
              />
            )}
          </div>
        ))}
      </div>
      {/* Status text */}
      <div className="text-[10.5px] text-muted-foreground/70 italic">
        {currentLabel}
        {figuresCount > 0 && figuresStatus !== "done" && (
          <span className="ml-1.5 text-muted-foreground/50">
            · 已提取 {figuresCount} 张主图
          </span>
        )}
      </div>
    </div>
  );
}
