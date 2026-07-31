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
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { cn, stripMarkdownInline } from "@/lib/utils";
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

  /**
   * Upload-stage signal from the parent — drives the "MinerU 正在加载"
   * indicator shown in the left panel BEFORE the LLM analysis starts.
   *   - "idle"      : no paper yet (show the empty placeholder)
   *   - "uploading" : PDF upload in flight
   *   - "parsing"   : MinerU 解析中（30-90s，最长的等待阶段）
   *   - "analyzing" : Stage 1 LLM 分析中（此时 outlineLoading 也为 true）
   *   - "done"      : 全部完成
   */
  uploadStage?: "idle" | "uploading" | "parsing" | "analyzing" | "done";
  /** Human-readable status text from the parent (e.g. "MinerU 解析中（30-90 秒）…"). */
  mineruStatus?: string;
};

// ── Section config: which parts exist + their display metadata ────────────

type SectionKey = "questionBackground" | "argumentSpine" | "novelty" | "limitsOpportunities";

// Low-saturation, multi-hue palette — cool/warm balance, no single-color wash.
// Each section gets its own hue family with matched tint & border.
const SECTIONS: Array<{
  key: SectionKey;
  index: number;
  title: string;
  color: string;
  soft: string;
  border: string;
}> = [
  { key: "questionBackground", index: 1, title: "问题与背景", color: "#5B7C99", soft: "#EAF0F5", border: "#C7D5E0" },  // slate-blue (cool)
  { key: "argumentSpine",     index: 2, title: "论证主线",     color: "#B8845C", soft: "#F7EFE7", border: "#E0CBB4" },  // warm tan (warm)
  { key: "novelty",           index: 3, title: "创新性",       color: "#7B6BA8", soft: "#EFEAF5", border: "#D5CCE6" },  // muted violet (cool-purple)
  { key: "limitsOpportunities", index: 4, title: "局限与机会",   color: "#5F8B7B", soft: "#E9F2EE", border: "#C4D9D0" },  // sage green (neutral-warm)
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
  uploadStage = "idle",
  mineruStatus = "",
}: Props) {
  const [retrying, setRetrying] = useState<string | null>(null);

  // ── Per-section fold state ────────────────────────────────────────────
  // User request: "开始的时候就展开成这样就可以了,不用把所有的内容都展开"
  // → only ONE section expanded by default (问题与背景), the other three
  //   collapsed. User can click any header to expand it.
  // The state is keyed by SectionKey. We initialize lazily so a freshly
  // loaded outline starts in the right fold state regardless of when its
  // content arrives.
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    questionBackground: true,   // 默认展开第一个
    argumentSpine: false,
    novelty: false,
    limitsOpportunities: false,
  });
  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // 当一个全新的 outline 到达时，重置回默认折叠态（仅 questionBackground 展开）。
  // 否则切换论文时上一份的展开状态会残留。
  const outlineTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (outline?.title && outlineTitleRef.current !== outline.title) {
      outlineTitleRef.current = outline.title;
      setOpenSections({
        questionBackground: true,
        argumentSpine: false,
        novelty: false,
        limitsOpportunities: false,
      });
    }
  }, [outline?.title]);

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

  // ── Header (always rendered) ────────────────────────────────────────────
  // Determine whether we're in the MinerU-parsing phase (before outline exists).
  // During this phase we show a dedicated "MinerU 正在加载" indicator inside
  // the panel body so the user knows what's happening on the left side.
  const isMineruLoading =
    !outline && (uploadStage === "uploading" || uploadStage === "parsing");
  // True while Stage 1 LLM analysis is running (after MinerU finished).
  const isAnalyzing =
    loading && !outline && uploadStage === "analyzing";

  return (
    <div className={cn("flex flex-col bg-card", collapsed ? "h-auto" : "h-full")}>
      {/* Panel header — always visible, click to collapse/expand the whole panel.
          Restored per user request: "我还是喜欢之前的那种排版方式,右上方展开栏".
          The outer `collapsed` prop controls the panel-level collapse (whole
          panel hidden except header); individual sections inside have their
          own per-section fold state (see openSections above). */}
      <button
        type="button"
        onClick={() => onCollapsedChange?.(!collapsed)}
        className={cn(
          "w-full px-3 py-2 flex items-center gap-2 text-left flex-shrink-0 transition-colors",
          "hover:bg-slate-100/60 dark:hover:bg-slate-800/40",
          "border-b border-slate-200/70 dark:border-slate-800/60",
          "bg-gradient-to-r from-slate-50/80 to-slate-100/40 dark:from-slate-900/60 dark:to-slate-900/30"
        )}
        title={collapsed ? "展开全文框架" : "折叠全文框架"}
        aria-label={collapsed ? "展开全文框架" : "折叠全文框架"}
        aria-expanded={!collapsed}
      >
        <LayoutGrid className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400 flex-shrink-0" />
        <span className="text-[12px] font-semibold flex-1 text-slate-700 dark:text-slate-300">
          全文框架
        </span>
        {outline && (
          <Badge
            variant="secondary"
            className="text-[10px] h-4 px-1.5 bg-slate-200/70 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
          >
            4 层
          </Badge>
        )}
        {/* 右上方展开/折叠按钮 — restores the previous layout's panel-level toggle */}
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0",
            !collapsed && "rotate-90"
          )}
        />
      </button>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <div className="p-2">
            {/* MinerU 解析阶段：uploadStage === "uploading" | "parsing".
                用户反馈「最开始的时候在左侧也显示一下mineru正在加载,不然不知道在干嘛」。
                在 outline 还没出现前，左面板需要明确的加载提示，而不是静态占位符。 */}
            {isMineruLoading && (
              <MineruLoadingIndicator
                stage={uploadStage}
                statusMessage={mineruStatus}
              />
            )}

            {/* Stage 1 LLM 分析阶段：MinerU 已完成、4 层 outline 正在生成 */}
            {isAnalyzing && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-xs">Agent 正在分析文献…</p>
                <p className="text-[10px] text-muted-foreground/70">
                  生成 4 层结构化分析（约 15-30 秒）
                </p>
              </div>
            )}

            {/* 完全空闲：还没传 PDF */}
            {!loading && !outline && uploadStage === "idle" && (
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
                  // Per-section fold state — defaults set above
                  // (argumentSpine collapsed, others expanded).
                  const isOpen = openSections[sec.key];
                  const isFailed = outline.failedParts?.includes(sec.key);
                  const isRetrying = retrying === sec.key;

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
                        "rounded-md border bg-card shadow-sm transition-all"
                      )}
                      style={{
                        borderLeft: `3px solid ${sec.color}`,
                        borderColor: sec.border,
                      }}
                    >
                      {/* Header — clickable to fold/unfold the section.
                          Main sections (Q&A, Novelty, Limits) start expanded;
                          ArgumentSpine starts collapsed (per user request:
                          "大标题默认展开, 论证主线默认缩起来"). */}
                      <button
                        type="button"
                        onClick={() => toggleSection(sec.key)}
                        aria-expanded={isOpen}
                        className={cn(
                          "w-full text-left px-2.5 py-2 flex items-start gap-2",
                          "rounded-t-md transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
                          "focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40",
                          !isOpen && "rounded-b-md"
                        )}
                        style={{ background: sec.soft }}
                      >
                        {/* Chevron fold indicator */}
                        <span className="flex-shrink-0 w-3 mt-0.5 flex items-center justify-center">
                          {isOpen ? (
                            <ChevronDown
                              className="h-3 w-3"
                              style={{ color: sec.color }}
                            />
                          ) : (
                            <ChevronRight
                              className="h-3 w-3"
                              style={{ color: sec.color }}
                            />
                          )}
                        </span>
                        <span
                          className="flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center mt-0.5"
                          style={{ background: sec.color }}
                        >
                          {sec.index}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-medium leading-snug"
                            style={{ fontSize: fs(13), color: sec.color }}
                          >
                            {sec.title}
                          </div>
                          {hasContent && (part as any)?.summary && (
                            <div
                              className={cn(
                                "text-muted-foreground mt-0.5 whitespace-pre-wrap break-words",
                                // 旧版折叠态会 line-clamp-2 截断 summary，
                                // 用户反馈「希望展示完整」——现在无论开合都完整展示。
                                "line-clamp-none"
                              )}
                              style={{ fontSize: fs(11) }}
                            >
                              {stripMarkdownInline((part as any).summary)}
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
                      </button>

                      {/* Body — only rendered when the section is open.
                          When closed, the button gets rounded-b-md so the
                          section header looks like a tidy collapsed chip. */}
                      {isOpen && (
                        <div className="px-2.5 pb-2.5 pt-0 space-y-2">
                          {/* ArgumentSpine: special rendering — summary + figure chain */}
                          {sec.key === "argumentSpine" && (
                            <>
                              {outline.argumentSpine?.summary && (
                                <div className="rounded bg-muted/40 px-2.5 py-2 text-[11.5px] leading-relaxed text-foreground/85 whitespace-pre-wrap break-words">
                                  {stripMarkdownInline(outline.argumentSpine.summary)}
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
                                    className="rounded border bg-muted/20 px-2 py-1.5"
                                    style={{ borderColor: sec.border }}
                                  >
                                    <div className="text-[11px] flex items-start gap-1.5">
                                      <span
                                        className="font-bold flex-shrink-0 text-white px-1 rounded text-[9px]"
                                        style={{ background: "#C8556C" }}
                                      >
                                        L{i + 1}
                                      </span>
                                      <span className="flex-1 text-foreground/85 whitespace-pre-wrap break-words">
                                        {stripMarkdownInline(p.limitation)}
                                      </span>
                                    </div>
                                    <div className="text-[11px] flex items-start gap-1.5 mt-0.5 pl-4">
                                      <span
                                        className="flex-shrink-0 text-white px-1 rounded text-[9px]"
                                        style={{ background: sec.color }}
                                      >
                                        →
                                      </span>
                                      <span className="flex-1 text-muted-foreground whitespace-pre-wrap break-words">
                                        {stripMarkdownInline(p.opportunity)}
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
                  AI 概括生成 · 点击图表可跳转原文核验
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

// ── MinerU loading indicator ───────────────────────────────────────────────
// Shown in the left panel during the upload + MinerU-parse phase (BEFORE
// the LLM Stage 1 analysis starts). User feedback: "最开始的时候在左侧也显示
// 一下mineru正在加载,不然不知道在干嘛".
//
// Visual: a card with a pulsing dot row (3 steps: 上传 → 解析 → 分析) and
// the live statusMessage from the parent (e.g. "MinerU 解析中…（已等 60s）").

function MineruLoadingIndicator({
  stage,
  statusMessage,
}: {
  stage: "uploading" | "parsing" | "analyzing" | "idle" | "done";
  statusMessage?: string;
}) {
  // Three-step progress: 上传 PDF → MinerU 解析 → 智能分析
  type StepState = "done" | "active" | "pending";
  const steps: Array<{ key: string; label: string; state: StepState }> = (() => {
    if (stage === "uploading") {
      return [
        { key: "upload", label: "上传 PDF", state: "active" },
        { key: "parse",  label: "MinerU 解析", state: "pending" },
        { key: "analyze", label: "智能分析", state: "pending" },
      ];
    }
    if (stage === "parsing") {
      return [
        { key: "upload", label: "上传 PDF", state: "done" },
        { key: "parse",  label: "MinerU 解析", state: "active" },
        { key: "analyze", label: "智能分析", state: "pending" },
      ];
    }
    if (stage === "analyzing") {
      return [
        { key: "upload", label: "上传 PDF", state: "done" },
        { key: "parse",  label: "MinerU 解析", state: "done" },
        { key: "analyze", label: "智能分析", state: "active" },
      ];
    }
    return [
      { key: "upload", label: "上传 PDF", state: "pending" },
      { key: "parse",  label: "MinerU 解析", state: "pending" },
      { key: "analyze", label: "智能分析", state: "pending" },
    ];
  })();

  const headline =
    stage === "uploading" ? "正在上传 PDF…"
    : stage === "parsing"  ? "MinerU 正在解析 PDF…"
    : stage === "analyzing" ? "MinerU 完成，正在分析…"
    : "等待中…";

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-gradient-to-b from-slate-50 to-slate-50/40 dark:from-slate-900/40 dark:to-slate-900/20 p-3 space-y-2.5">
      {/* Headline */}
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600 dark:text-slate-400 flex-shrink-0" />
        <span className="text-[12px] font-medium text-slate-700 dark:text-slate-300">
          {headline}
        </span>
      </div>

      {/* 3-step progress dots */}
      <div className="flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-1 min-w-0">
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full flex-shrink-0",
                s.state === "done" && "bg-emerald-500",
                s.state === "active" && "bg-slate-600 dark:bg-slate-300 animate-pulse",
                s.state === "pending" && "bg-muted-foreground/25"
              )}
            />
            <span
              className={cn(
                "text-[10px] truncate",
                s.state === "done" && "text-emerald-600 dark:text-emerald-400",
                s.state === "active" && "text-slate-700 dark:text-slate-200 font-medium",
                s.state === "pending" && "text-muted-foreground/60"
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-px min-w-[6px]",
                  s.state === "done" ? "bg-emerald-500/40" : "bg-border"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Live status message from parent (e.g. "MinerU 解析中…（已等 60s）") */}
      {statusMessage && (
        <div className="text-[10.5px] text-muted-foreground/70 italic leading-relaxed break-words">
          {statusMessage}
        </div>
      )}

      {/* Helpful tip — explains what MinerU is doing behind the scenes */}
      <div className="text-[10px] text-muted-foreground/60 leading-relaxed border-t border-slate-200/60 dark:border-slate-800/60 pt-2">
        {stage === "uploading" && "正在将 PDF 上传至服务器，随后启动结构化解析。"}
        {stage === "parsing" && "MinerU 正在抽取段落、图表与版式信息，通常需要 30-90 秒，复杂 PDF 可能更久。完成后将自动进入智能分析。"}
        {stage !== "uploading" && stage !== "parsing" && "解析完成，正在生成 4 层结构化分析。"}
      </div>
    </div>
  );
}
