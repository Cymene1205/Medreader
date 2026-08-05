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

export type Subsection = {
  heading: string;
  body: string;
  bullets: string[];
};

export type AnalysisJson = {
  title: string;
  questionBackground: {
    summary: string;
    detail: string;
    subsections?: Subsection[];
  } | null;
  argumentSpine: { summary: string; linchpinFigure: string | null } | null;
  novelty: {
    summary: string;
    detail: string;
    subsections?: Subsection[];
  } | null;
  limitsOpportunities: {
    summary: string;
    detail: string;
    subsections?: Subsection[];
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
  /** LLM headers from LLMSettingsDialog — attached to retry /api/analyze calls
   *  so the user's UI-configured key is used instead of the server env default. */
  llmHeaders?: Record<string, string>;
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

// Shared pixel-size helper — kept at module scope so standalone helper
// components (SubsectionChain, PipelineLoadingIndicator, etc.) can use it
// without needing it passed as a prop.
const fs = (px: number) => `${px}px`;


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
  llmHeaders = {},
}: Props) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const llmHeadersRef = useRef(llmHeaders);
  llmHeadersRef.current = llmHeaders;

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

  // Retry a failed part
  const retryPart = useCallback(
    async (part: string) => {
      if (!paperId) return;
      setRetrying(part);
      try {
        const res = await fetch(`/api/analyze?part=${part}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...llmHeadersRef.current },
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
  // Determine whether we're in the upload + parse + analyze pipeline.
  // User request: "刚开始现在不是有minerU解析框我很喜欢,可以吧agent分析
  // 的那个进程也放在那里显示一致一点,进度条拉长一点儿把agent分析也放进去"
  // → unify the MinerU loading indicator and the Agent analysis indicator
  //   into a single 4-step progress bar (上传 PDF → MinerU 解析 → 图表提取
  //   → 智能分析). Show the same component for both phases so the user sees
  //   one continuous progress flow on the left side.
  const isMineruLoading =
    !outline && (uploadStage === "uploading" || uploadStage === "parsing");
  // True while Stage 1 LLM analysis is running (after MinerU finished).
  const isAnalyzing =
    loading && !outline && uploadStage === "analyzing";
  // True once Stage 2 (figure extraction + Call A + spine) is in flight
  // AND the outline isn't ready yet — adds a "图表提取" sub-step to the bar.
  const isExtractingFigures =
    !outline && (figuresStatus === "extracting" || figuresStatus === "call-a");

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
            {/* Unified loading indicator — shown for the ENTIRE upload →
                MinerU parse → figure extraction → Agent analysis pipeline.
                User request: unify so the user sees one continuous progress
                bar on the left side rather than two different loading UIs. */}
            {(isMineruLoading || isAnalyzing || isExtractingFigures) && (
              <PipelineLoadingIndicator
                uploadStage={uploadStage}
                figuresStatus={figuresStatus}
                figuresCount={figures.length}
                statusMessage={mineruStatus}
              />
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
                          {/* ArgumentSpine: summary is already shown in the
                              section header (always visible whether open or
                              collapsed). Per user request, do NOT repeat it
                              here in the expanded body — only show the figure
                              chain. */}
                          {sec.key === "argumentSpine" && (
                            <>
                              {figures.length > 0 ? (
                                <FigureChain
                                  paperId={paperId || null}
                                  figures={figures}
                                  citations={citations}
                                  onPanelChipClick={onPanelChipClick || (() => {})}
                                  onJumpToPage={onJumpToPage || (() => {})}
                                  llmHeaders={llmHeaders}
                                />
                              ) : (
                                <div className="text-center py-3 text-[10px] text-muted-foreground/60">
                                  {loading
                                    ? "论证主线生成中…"
                                    : "（本文无主图，已基于原文生成文字版论证主线 — 详见上方摘要）"}
                                </div>
                              )}
                            </>
                          )}

                          {/* Standard sections (问题与背景 / 创新性 / 局限与机会):
                              Multi-level collapsible cards — mimics the
                              figure-chain layer list visual language.
                              User request: "把背景还有创新性,限制性也根据自己
                              的内容做成多级折叠的形式,不像现在全都扑在一块儿" */}
                          {sec.key !== "argumentSpine" && part && (part as any).subsections && (part as any).subsections.length > 0 && (
                            <SubsectionChain
                              subsections={(part as any).subsections}
                              accentColor={sec.color}
                              softColor={sec.soft}
                              borderColor={sec.border}
                            />
                          )}

                          {/* Fallback: if no subsections, but `detail` markdown
                              exists (old/cached analyses), render with the
                              single-card SectionDetail layout. */}
                          {sec.key !== "argumentSpine" && part && !(part as any).subsections?.length && (part as any).detail && (
                            <SectionDetail
                              detail={(part as any).detail}
                              accentColor={sec.color}
                              softColor={sec.soft}
                              borderColor={sec.border}
                            />
                          )}

                          {/* LimitsOpportunities: render pairs as two-column
                              限制 / 机会 cards with arrow connectors — same
                              visual language as the figure-chain layer list.
                              Only render when no subsections (subsections
                              already include opportunities inline). */}
                          {sec.key === "limitsOpportunities" &&
                            !outline.limitsOpportunities?.subsections?.length &&
                            outline.limitsOpportunities?.pairs &&
                            outline.limitsOpportunities.pairs.length > 0 && (
                              <div className="space-y-1.5 mt-2">
                                {outline.limitsOpportunities.pairs.map((p, i) => (
                                  <div
                                    key={i}
                                    className="rounded-md border bg-card overflow-hidden shadow-sm"
                                    style={{ borderColor: sec.border }}
                                  >
                                    {/* Pair header: index badge */}
                                    <div
                                      className="px-2 py-1 flex items-center gap-1.5"
                                      style={{ background: sec.soft }}
                                    >
                                      <span
                                        className="flex-shrink-0 w-4 h-4 rounded text-[9px] font-bold text-white flex items-center justify-center"
                                        style={{ background: sec.color }}
                                      >
                                        {i + 1}
                                      </span>
                                      <span
                                        className="text-[10px] font-medium uppercase tracking-wide"
                                        style={{ color: sec.color }}
                                      >
                                        局限 → 机会
                                      </span>
                                    </div>
                                    {/* Limitation row */}
                                    <div className="px-2 py-1.5 flex items-start gap-1.5 border-b border-dashed" style={{ borderColor: sec.border }}>
                                      <span
                                        className="flex-shrink-0 w-4 h-4 rounded text-[9px] font-mono font-bold text-white flex items-center justify-center mt-0.5"
                                        style={{ background: "#C8556C" }}
                                      >
                                        L
                                      </span>
                                      <span className="flex-1 text-[11px] leading-relaxed text-foreground/85 whitespace-pre-wrap break-words">
                                        {stripMarkdownInline(p.limitation)}
                                      </span>
                                    </div>
                                    {/* Opportunity row */}
                                    <div className="px-2 py-1.5 flex items-start gap-1.5 bg-muted/20">
                                      <span
                                        className="flex-shrink-0 w-4 h-4 rounded text-[9px] font-mono font-bold text-white flex items-center justify-center mt-0.5"
                                        style={{ background: sec.color }}
                                      >
                                        O
                                      </span>
                                      <span className="flex-1 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
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

// ── Pipeline loading indicator ────────────────────────────────────────────
// Unified progress bar covering the ENTIRE pre-outline pipeline:
//   Step 1: 上传 PDF            (uploadStage: uploading)
//   Step 2: MinerU 解析          (uploadStage: parsing)
//   Step 3: 图表提取             (figuresStatus: extracting → call-a)
//   Step 4: 智能分析             (uploadStage: analyzing, or figuresStatus: spine)
//
// User request: "刚开始现在不是有minerU解析框我很喜欢,可以吧agent分析的那个
// 进程也放在那里显示一致一点,进度条拉长一点儿把agent分析也放进去"
// → one indicator, four steps, longer bar, consistent visuals across phases.

function PipelineLoadingIndicator({
  uploadStage,
  figuresStatus,
  figuresCount,
  statusMessage,
}: {
  uploadStage: "uploading" | "parsing" | "analyzing" | "idle" | "done";
  figuresStatus: "idle" | "extracting" | "call-a" | "spine" | "done" | "error";
  figuresCount: number;
  statusMessage?: string;
}) {
  // Four-step progress — wider bar, distinct sub-status for each phase.
  type StepState = "done" | "active" | "pending";
  const steps: Array<{ key: string; label: string; state: StepState }> = (() => {
    // Upload phase
    if (uploadStage === "uploading") {
      return [
        { key: "upload",  label: "上传 PDF",     state: "active" },
        { key: "parse",   label: "MinerU 解析",  state: "pending" },
        { key: "extract", label: "图表提取",     state: "pending" },
        { key: "analyze", label: "智能分析",     state: "pending" },
      ];
    }
    // MinerU parsing phase
    if (uploadStage === "parsing") {
      return [
        { key: "upload",  label: "上传 PDF",     state: "done" },
        { key: "parse",   label: "MinerU 解析",  state: "active" },
        { key: "extract", label: "图表提取",     state: "pending" },
        { key: "analyze", label: "智能分析",     state: "pending" },
      ];
    }
    // Figure extraction phase (after MinerU done, Call A in flight)
    if (figuresStatus === "extracting" || figuresStatus === "call-a") {
      return [
        { key: "upload",  label: "上传 PDF",     state: "done" },
        { key: "parse",   label: "MinerU 解析",  state: "done" },
        { key: "extract", label: "图表提取",     state: "active" },
        { key: "analyze", label: "智能分析",     state: "pending" },
      ];
    }
    // Agent analysis phase (Stage 1 LLM call in flight, or Stage 2 spine)
    if (uploadStage === "analyzing" || figuresStatus === "spine") {
      return [
        { key: "upload",  label: "上传 PDF",     state: "done" },
        { key: "parse",   label: "MinerU 解析",  state: "done" },
        { key: "extract", label: "图表提取",     state: figuresCount > 0 ? "done" : "active" },
        { key: "analyze", label: "智能分析",     state: "active" },
      ];
    }
    return [
      { key: "upload",  label: "上传 PDF",     state: "pending" },
      { key: "parse",   label: "MinerU 解析",  state: "pending" },
      { key: "extract", label: "图表提取",     state: "pending" },
      { key: "analyze", label: "智能分析",     state: "pending" },
    ];
  })();

  const headline =
    uploadStage === "uploading" ? "正在上传 PDF…"
    : uploadStage === "parsing"  ? "MinerU 正在解析 PDF…"
    : figuresStatus === "extracting" || figuresStatus === "call-a"
      ? "正在提取图表并生成层级化分析…"
      : uploadStage === "analyzing" || figuresStatus === "spine"
        ? "Agent 正在生成 4 层结构化分析…"
        : "等待中…";

  // Per-stage tip — gives the user context about what's happening behind
  // the scenes at each step so they don't think the page is frozen.
  const tip =
    uploadStage === "uploading" ? "正在将 PDF 上传至服务器，随后启动结构化解析。"
    : uploadStage === "parsing" ? "MinerU 正在抽取段落、图表与版式信息，通常需要 30-90 秒，复杂 PDF 可能更久。"
    : figuresStatus === "extracting" || figuresStatus === "call-a"
      ? "MinerU 完成解析，正在批量分析所有主图（Call A），用于构建论证主线。"
      : uploadStage === "analyzing" || figuresStatus === "spine"
        ? "正在生成 4 层结构化分析（问题与背景 · 论证主线 · 创新性 · 局限与机会），约 15-30 秒。"
        : "";

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-gradient-to-b from-slate-50 to-slate-50/40 dark:from-slate-900/40 dark:to-slate-900/20 p-3 space-y-2.5">
      {/* Headline */}
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-600 dark:text-slate-400 flex-shrink-0" />
        <span className="text-[12px] font-medium text-slate-700 dark:text-slate-300">
          {headline}
        </span>
      </div>

      {/* 4-step progress dots — wider bar, equal-width columns */}
      <div className="flex items-stretch gap-0.5">
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
                "text-[9.5px] truncate leading-tight",
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
                  "flex-1 h-px min-w-[4px] mx-0.5",
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

      {/* Helpful tip — explains what's happening behind the scenes */}
      {tip && (
        <div className="text-[10px] text-muted-foreground/60 leading-relaxed border-t border-slate-200/60 dark:border-slate-800/60 pt-2">
          {tip}
        </div>
      )}
    </div>
  );
}

// ── Legacy alias kept for any external importers (unused now, but
// removing it would force a search-and-replace across the codebase). ──
const MineruLoadingIndicator = PipelineLoadingIndicator;

// ── Subsection chain ──────────────────────────────────────────────────────
// Multi-level collapsible cards for the 3 standard sections (问题与背景 /
// 创新性 / 局限与机会). Mimics the figure-chain layer list visual language:
//   - Vertical line on the left
//   - Each subsection = one card sitting on the line with a colored dot
//   - Card header (always visible): numbered badge + heading + body preview
//   - Click to expand: full body paragraph + bullet list with colored dots
//
// User request: "把背景还有创新性,限制性也根据自己的内容做成多级折叠的形式,
// 不像现在全都扑在一块儿,可能需要处理好提示词结构化回复,完了写好表达框长啥样,
// 可以模仿论证主线的主体排版"
//
// Default state: first subsection expanded, others collapsed — gives the
// reader a glimpse of the content immediately without overwhelming them.

function SubsectionChain({
  subsections,
  accentColor,
  softColor,
  borderColor,
}: {
  subsections: Subsection[];
  accentColor: string;
  softColor: string;
  borderColor: string;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  if (!subsections || subsections.length === 0) return null;

  return (
    <div className="relative pl-5 pr-1 py-1.5">
      {/* Vertical line on the left — same visual idiom as FigureChain */}
      <div
        className="absolute left-[6px] top-3 bottom-3 w-[2px]"
        style={{ background: `${accentColor}40` }}
        aria-hidden
      />

      <div className="space-y-1.5">
        {subsections.map((sub, idx) => {
          const isExpanded = expandedIdx === idx;
          // Brief preview: first ~80 chars of body, single line, ellipsis
          const bodyPreview = (sub.body || "").replace(/\s+/g, " ").trim().slice(0, 80);
          const hasBullets = sub.bullets && sub.bullets.length > 0;

          return (
            <div key={idx} className="relative">
              {/* Dot on the line */}
              <div
                className="absolute left-[-18px] top-3 w-[10px] h-[10px] rounded-full border-2 border-background"
                style={{ background: accentColor }}
                aria-hidden
              />

              {/* Card */}
              <div
                className={cn(
                  "rounded-md border bg-card shadow-sm transition-all overflow-hidden",
                  isExpanded ? "shadow-md" : "hover:shadow-sm"
                )}
                style={{
                  borderColor: isExpanded ? `${accentColor}80` : borderColor,
                }}
              >
                {/* Header (always visible) — click to toggle expand */}
                <button
                  type="button"
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  aria-expanded={isExpanded}
                  className="w-full text-left px-2.5 py-2 flex items-start gap-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                >
                  {/* Numbered badge — colored block with the subsection index */}
                  <span
                    className="flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center mt-0.5"
                    style={{ background: accentColor }}
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    {/* Heading row */}
                    <div
                      className="font-medium leading-snug"
                      style={{ fontSize: fs(12), color: accentColor }}
                    >
                      {stripMarkdownInline(sub.heading)}
                    </div>
                    {/* Body preview — only when collapsed (avoid duplication) */}
                    {!isExpanded && bodyPreview && (
                      <div
                        className="text-muted-foreground/80 mt-0.5 leading-snug line-clamp-2"
                        style={{ fontSize: fs(11) }}
                      >
                        {bodyPreview}
                        {sub.body.length > 80 ? "…" : ""}
                      </div>
                    )}
                    {/* Bullet preview — show first bullet as a chip when collapsed */}
                    {!isExpanded && hasBullets && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {sub.bullets.slice(0, 2).map((b, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[9.5px] leading-tight"
                            style={{
                              background: `${accentColor}12`,
                              color: accentColor,
                            }}
                          >
                            {stripMarkdownInline(b).slice(0, 40)}
                            {b.length > 40 ? "…" : ""}
                          </span>
                        ))}
                        {sub.bullets.length > 2 && (
                          <span
                            className="text-[9.5px] text-muted-foreground/60 px-1"
                          >
                            +{sub.bullets.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 flex-shrink-0 mt-1 transition-transform",
                      isExpanded && "rotate-90"
                    )}
                    style={{ color: accentColor }}
                  />
                </button>

                {/* Expanded body */}
                {isExpanded && (
                  <div
                    className="px-2.5 pb-2.5 pt-0 space-y-2 border-t"
                    style={{ borderColor: `${accentColor}30` }}
                  >
                    {/* Body paragraph — full text */}
                    {sub.body && (
                      <div
                        className="text-[11.5px] leading-[1.75] text-foreground/85 whitespace-pre-wrap break-words pt-2"
                      >
                        {stripMarkdownInline(sub.body)}
                      </div>
                    )}

                    {/* Bullets — colored dots, similar to figure-chain layer list */}
                    {hasBullets && (
                      <ul className="space-y-1 pt-0.5">
                        {sub.bullets.map((b, i) => (
                          <li
                            key={i}
                            className="text-[11px] leading-relaxed flex items-start gap-1.5 list-none"
                          >
                            <span
                              className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-[7px]"
                              style={{ background: accentColor }}
                              aria-hidden
                            />
                            <span className="flex-1 text-foreground/80 whitespace-pre-wrap break-words">
                              {stripMarkdownInline(b)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section detail card ───────────────────────────────────────────────────
// Renders the `detail` markdown of a standard section (问题与背景 / 创新性 /
// 局限与机会) with a card-style layout that matches the visual language of
// 论证主线 — colored accent bar on the left, soft tinted background, and
// typography tuned for academic reading (12.5px body, 1.75 line-height).
//
// The accent color, soft tint and border color are all derived from the
// section's color palette (defined in SECTIONS above) so each section gets
// its own hue family — same convention as the figure-chain layer list.
//
// Markdown features supported (via ReactMarkdown + remarkGfm + rehypeRaw):
//   - **bold** / *italic*
//   - <sup>/<sub> HTML tags (for scientific notation like CD11b<sup>+</sup>)
//   - Bullet lists (-) and numbered lists (1.)
//   - Headings (## / ###) — rendered with subtle accent color
//   - Inline `code`
//   - Paragraphs

function SectionDetail({
  detail,
  accentColor,
  softColor,
  borderColor,
}: {
  detail: string;
  accentColor: string;
  softColor: string;
  borderColor: string;
}) {
  return (
    <div
      className="rounded-md border overflow-hidden shadow-sm"
      style={{
        borderColor: borderColor,
        background: `linear-gradient(180deg, ${softColor} 0%, transparent 60%)`,
      }}
    >
      {/* Accent bar — thin colored stripe on top to anchor the section */}
      <div
        className="h-0.5 w-full"
        style={{ background: accentColor }}
        aria-hidden
      />
      {/* Body — markdown rendered with custom element styling so it matches
          the figure-chain typography rather than the default chat-markdown. */}
      <div
        className="px-3 py-2.5 text-[12.5px] leading-[1.75] text-foreground/85 chat-markdown"
        style={{
          // CSS variable consumed by chat-markdown custom heading styles below
          ["--section-accent" as any]: accentColor,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            // Headings — small accent-colored bars (don't let LLM-emitted
            // headings dominate the layout; this is a card body, not a page)
            h1: ({ children }) => (
              <div
                className="text-[12.5px] font-semibold mt-2 mb-1.5 flex items-center gap-1.5"
                style={{ color: accentColor }}
              >
                <span
                  className="inline-block w-1 h-3 rounded-sm"
                  style={{ background: accentColor }}
                />
                {children}
              </div>
            ),
            h2: ({ children }) => (
              <div
                className="text-[12.5px] font-semibold mt-2 mb-1.5 flex items-center gap-1.5"
                style={{ color: accentColor }}
              >
                <span
                  className="inline-block w-1 h-3 rounded-sm"
                  style={{ background: accentColor }}
                />
                {children}
              </div>
            ),
            h3: ({ children }) => (
              <div
                className="text-[11.5px] font-medium mt-1.5 mb-1"
                style={{ color: accentColor }}
              >
                {children}
              </div>
            ),
            // Paragraphs — generous spacing between them
            p: ({ children }) => (
              <p className="my-1.5 whitespace-pre-wrap break-words">{children}</p>
            ),
            // Lists — tighter spacing, accent-colored bullets
            ul: ({ children }) => (
              <ul className="my-1.5 space-y-1 pl-1">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="my-1.5 space-y-1 pl-1 list-decimal ml-3">{children}</ol>
            ),
            li: ({ children, ...props }) => {
              // Render unordered list items with a colored dot prefix
              const isOrdered = (props as any).className?.includes("list-decimal") || false;
              if (isOrdered) {
                return <li className="text-[12px] leading-relaxed pl-1">{children}</li>;
              }
              return (
                <li className="text-[12px] leading-relaxed flex items-start gap-1.5 list-none">
                  <span
                    className="flex-shrink-0 w-1 h-1 rounded-full mt-[7px]"
                    style={{ background: accentColor }}
                    aria-hidden
                  />
                  <span className="flex-1">{children}</span>
                </li>
              );
            },
            // Strong / em — keep the accent color for bold for emphasis
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">{children}</strong>
            ),
            // Inline code — small monospace pill
            code: ({ children }) => (
              <code
                className="px-1 py-0.5 rounded text-[11px] font-mono"
                style={{
                  background: `${accentColor}15`,
                  color: accentColor,
                }}
              >
                {children}
              </code>
            ),
            // Blockquote — pull-quote style with left accent bar
            blockquote: ({ children }) => (
              <blockquote
                className="my-2 pl-2.5 py-1 italic text-foreground/75"
                style={{
                  borderLeft: `3px solid ${accentColor}`,
                  background: `${accentColor}08`,
                }}
              >
                {children}
              </blockquote>
            ),
          }}
        >
          {detail}
        </ReactMarkdown>
      </div>
    </div>
  );
}
