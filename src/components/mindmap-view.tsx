"use client";

import { useMemo } from "react";
import {
  Network,
  Loader2,
  FileText,
  Lightbulb,
  FlaskConical,
  AlertCircle,
  ArrowRight,
  Target,
  Compass,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import type { Outline, OutlineChild, OutlineSection } from "@/components/outline-panel";
import type { Figure } from "@/components/figure-chain";
import { stripMarkdownInline } from "@/lib/utils";

type MindmapViewProps = {
  outline: Outline | null;
  figures?: Figure[];
  onChildClick: (child: OutlineChild, section: OutlineSection) => void;
  onFigureClick?: (figureLabel: string) => void;
};

// ── Color system: low-saturation, multi-hue, coordinated ───────────────────
//   4 sections use 4 distinct hues — cool/warm balance, no single-color wash.
//   Hex values are HSL-derived with sat ≈ 25-35%, light ≈ 45-55% for the
//   accent and 95% for the tint background.

const SECTION_THEME = {
  questionBackground: {
    label: "01",
    title: "问题与背景",
    icon: Target,
    accent: "#5B7C99",        // slate-blue (cool)
    accentSoft: "#EAF0F5",    // very pale slate
    accentBorder: "#C7D5E0",
    textOnAccent: "#FFFFFF",
  },
  argumentSpine: {
    label: "02",
    title: "论证主线",
    icon: Compass,
    accent: "#B8845C",        // warm tan / terracotta (warm)
    accentSoft: "#F7EFE7",
    accentBorder: "#E0CBB4",
    textOnAccent: "#FFFFFF",
  },
  novelty: {
    label: "03",
    title: "创新性",
    icon: Lightbulb,
    accent: "#7B6BA8",        // muted violet (cool-purple)
    accentSoft: "#EFEAF5",
    accentBorder: "#D5CCE6",
    textOnAccent: "#FFFFFF",
  },
  limitsOpportunities: {
    label: "04",
    title: "局限与机会",
    icon: FlaskConical,
    accent: "#5F8B7B",        // sage green (warm-cool neutral)
    accentSoft: "#E9F2EE",
    accentBorder: "#C4D9D0",
    textOnAccent: "#FFFFFF",
  },
} as const;

type SectionKey = keyof typeof SECTION_THEME;

// ── Bullet parsing ─────────────────────────────────────────────────────────
//   detail 是 LLM 返回的 markdown 字符串。我们把它拆成「条目列表」用于海报展示：
//   - ### / ## 开头 → 副标题条目（isSubtitle=true）
//   - - / * / 1. 开头 → 列表条目（isSubtitle=false）
//   - 普通正文段落 → 也作为条目展示（isSubtitle=false）
//     ↑ 旧版直接丢弃正文，导致用户只看到标题+列表，看不到论文核心论述。
//     用户反馈「还有一些字符串/希望展示完整」就是这个问题。
//   所有条目文本都过 stripMarkdownInline，剥掉 **、###、[1] 等残留标记。

type ParsedBullet = { text: string; isSubtitle: boolean; order: number };

function parseDetailBullets(detail: string | undefined): ParsedBullet[] {
  if (!detail) return [];
  // 先按双换行切段（markdown 段落），再按单换行拆行
  const paragraphs = detail.split(/\n{2,}/);
  const out: ParsedBullet[] = [];
  let order = 0;
  for (const para of paragraphs) {
    const lines = para.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    // 段内每行单独判断类型（标题行 vs 列表行 vs 正文行）
    for (const l of lines) {
      // 标题：### / ## 开头
      const subMatch = l.match(/^#{2,3}\s+(.+)$/);
      if (subMatch) {
        const t = stripMarkdownInline(subMatch[1]);
        if (t.length > 2) {
          out.push({ text: t, isSubtitle: true, order: order++ });
        }
        continue;
      }
      // 列表：- / * 开头
      const bulMatch = l.match(/^[-*]\s+(.+)$/);
      if (bulMatch) {
        const t = stripMarkdownInline(bulMatch[1]);
        if (t.length > 2) {
          out.push({ text: t, isSubtitle: false, order: order++ });
        }
        continue;
      }
      // 编号列表：1. 开头
      const numMatch = l.match(/^\d+\.\s+(.+)$/);
      if (numMatch) {
        const t = stripMarkdownInline(numMatch[1]);
        if (t.length > 2) {
          out.push({ text: t, isSubtitle: false, order: order++ });
        }
        continue;
      }
      // 正文段落：直接作为一条条目（旧版会丢弃，导致内容缺失）
      const t = stripMarkdownInline(l);
      if (t.length > 5) {
        out.push({ text: t, isSubtitle: false, order: order++ });
      }
    }
  }
  return out;
}

// ── Main poster component ──────────────────────────────────────────────────

export default function MindmapView({
  outline,
  figures = [],
  onChildClick,
  onFigureClick,
}: MindmapViewProps) {
  // Sorted figures (by figure number, fallback to chainIndex)
  const sortedFigures = useMemo(() => {
    return [...figures].sort((a, b) => {
      const an = parseInt(a.label.replace(/\D/g, ""), 10) || 0;
      const bn = parseInt(b.label.replace(/\D/g, ""), 10) || 0;
      return an - bn;
    });
  }, [figures]);

  // Empty state
  if (!outline) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
        <div className="text-center text-muted-foreground px-6">
          <Network className="h-10 w-10 mx-auto opacity-40 mb-2" />
          <p className="text-sm font-medium">导入 PDF 后自动生成结构化海报</p>
          <p className="text-[11px] mt-1 text-muted-foreground/70">
            自上而下：标题 → 问题 → 验证 → 创新 → 局限
          </p>
        </div>
      </div>
    );
  }

  // Check if any content exists
  const hasAnyContent =
    outline.questionBackground ||
    outline.argumentSpine ||
    outline.novelty ||
    outline.limitsOpportunities ||
    sortedFigures.length > 0;

  if (!hasAnyContent) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
        <div className="text-center text-muted-foreground px-6">
          <Loader2 className="h-6 w-6 mx-auto animate-spin mb-2 text-primary" />
          <p className="text-sm font-medium">正在分析…</p>
          <p className="text-[11px] mt-1 text-muted-foreground/70">
            Agent 正在生成结构化海报
          </p>
        </div>
      </div>
    );
  }

  const title = outline.title || "（未识别论文标题）";

  return (
    <div className="h-full w-full overflow-y-auto bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Poster container — max-width for readability, centered */}
      <div className="mx-auto max-w-[860px] px-6 py-8 space-y-5">

        {/* ── Hero: paper title ──────────────────────────────────────────── */}
        <header
          className="relative overflow-hidden rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800"
          style={{
            background:
              "linear-gradient(135deg, #475569 0%, #5B7C99 50%, #6B8DA8 100%)",
          }}
        >
          {/* Decorative grid pattern */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "24px 24px",
            }}
          />
          <div className="relative px-7 py-8 text-white">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-semibold opacity-80 mb-3">
              <FileText className="h-3 w-3" />
              <span>Research Paper</span>
            </div>
            <h1 className="text-[22px] md:text-[26px] font-bold leading-[1.35] tracking-tight">
              {title}
            </h1>
            {outline.failedParts && outline.failedParts.length > 0 && (
              <div className="mt-3 text-[11px] opacity-70 flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3" />
                <span>
                  {outline.failedParts.length} 部分生成失败 · 可在「全文框架」中重试
                </span>
              </div>
            )}
          </div>
        </header>

        {/* ── Section 01: Question & Background ──────────────────────────── */}
        {(outline.questionBackground?.summary || outline.questionBackground?.detail) && (
          <PosterSection
            theme={SECTION_THEME.questionBackground}
            summary={outline.questionBackground?.summary}
            detail={outline.questionBackground?.detail}
            onChildClick={onChildClick}
          />
        )}

        {/* ── Section 02: Argument Spine ─────────────────────────────────── */}
        {(outline.argumentSpine?.summary || sortedFigures.length > 0) && (
          <ArgumentSpineSection
            theme={SECTION_THEME.argumentSpine}
            summary={outline.argumentSpine?.summary}
            figures={sortedFigures}
            linchpinFigure={outline.argumentSpine?.linchpinFigure}
            onFigureClick={onFigureClick}
          />
        )}

        {/* ── Section 03: Novelty ────────────────────────────────────────── */}
        {(outline.novelty?.summary || outline.novelty?.detail) && (
          <PosterSection
            theme={SECTION_THEME.novelty}
            summary={outline.novelty?.summary}
            detail={outline.novelty?.detail}
            onChildClick={onChildClick}
          />
        )}

        {/* ── Section 04: Limits & Opportunities ─────────────────────────── */}
        {(outline.limitsOpportunities?.summary ||
          (outline.limitsOpportunities?.pairs &&
            outline.limitsOpportunities.pairs.length > 0)) && (
          <LimitsOpportunitiesSection
            theme={SECTION_THEME.limitsOpportunities}
            summary={outline.limitsOpportunities?.summary}
            detail={outline.limitsOpportunities?.detail}
            pairs={outline.limitsOpportunities?.pairs || []}
            onChildClick={onChildClick}
          />
        )}

        {/* Footer */}
        <div className="pt-2 pb-4 text-center text-[10px] text-muted-foreground/60">
          AI 概括生成 · 内容仅供研究参考 · 请回原文核验
        </div>
      </div>
    </div>
  );
}

// ── Generic poster section (used by 01/03) ────────────────────────────────

function PosterSection({
  theme,
  summary,
  detail,
  onChildClick,
}: {
  theme: typeof SECTION_THEME[SectionKey];
  summary?: string;
  detail?: string;
  onChildClick: (child: OutlineChild, section: OutlineSection) => void;
}) {
  const bullets = parseDetailBullets(detail);
  const Icon = theme.icon;

  return (
    <section
      className="relative rounded-2xl border bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      style={{ borderColor: theme.accentBorder }}
    >
      {/* Top accent strip */}
      <div
        aria-hidden
        className="h-1.5"
        style={{ background: theme.accent }}
      />

      {/* Section header */}
      <header
        className="px-6 pt-5 pb-3 flex items-start gap-3"
        style={{ background: theme.accentSoft }}
      >
        <div
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
          style={{ background: theme.accent }}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] font-bold tracking-[0.15em] mb-0.5"
            style={{ color: theme.accent }}
          >
            SECTION {theme.label}
          </div>
          <h2 className="text-[18px] font-semibold text-foreground leading-tight">
            {theme.title}
          </h2>
        </div>
      </header>

      {/* Body */}
      <div className="px-6 py-4 space-y-3.5">
        {/* Summary callout */}
        {summary && (
          <div
            className="text-[13px] leading-[1.7] text-foreground/85 rounded-lg px-3.5 py-2.5 border-l-[3px] whitespace-pre-wrap"
            style={{
              background: theme.accentSoft,
              borderColor: theme.accent,
            }}
          >
            {stripMarkdownInline(summary)}
          </div>
        )}

        {/* Detail bullets */}
        {bullets.length > 0 && (
          <div className="space-y-2">
            {bullets.map((b, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5"
              >
                <div
                  className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full"
                  style={{ background: theme.accent }}
                  aria-hidden
                />
                <div
                  className={
                    b.isSubtitle
                      ? "text-[13px] font-semibold text-foreground leading-snug"
                      : "text-[12.5px] leading-[1.65] text-foreground/80"
                  }
                >
                  {b.text}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fallback: render raw markdown if no bullets parsed (e.g., prose paragraph) */}
        {bullets.length === 0 && detail && (
          <div className="chat-markdown text-[12.5px] leading-[1.7] text-foreground/85">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {detail}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Argument spine section (special: includes figure cards) ──────────────

function ArgumentSpineSection({
  theme,
  summary,
  figures,
  linchpinFigure,
  onFigureClick,
}: {
  theme: typeof SECTION_THEME[SectionKey];
  summary?: string;
  figures: Figure[];
  linchpinFigure?: string | null;
  onFigureClick?: (figureLabel: string) => void;
}) {
  const Icon = theme.icon;

  return (
    <section
      className="relative rounded-2xl border bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      style={{ borderColor: theme.accentBorder }}
    >
      <div
        aria-hidden
        className="h-1.5"
        style={{ background: theme.accent }}
      />

      <header
        className="px-6 pt-5 pb-3 flex items-start gap-3"
        style={{ background: theme.accentSoft }}
      >
        <div
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
          style={{ background: theme.accent }}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] font-bold tracking-[0.15em] mb-0.5"
            style={{ color: theme.accent }}
          >
            SECTION {theme.label}
          </div>
          <h2 className="text-[18px] font-semibold text-foreground leading-tight">
            {theme.title}
          </h2>
          <p className="text-[10.5px] text-muted-foreground mt-1">
            {figures.length > 0
              ? `${figures.length} 张主图按论证顺序串联`
              : "暂无图表数据"}
            {linchpinFigure && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                命门 · {linchpinFigure}
              </span>
            )}
          </p>
        </div>
      </header>

      <div className="px-6 py-4 space-y-3.5">
        {/* Summary callout */}
        {summary && (
          <div
            className="text-[13px] leading-[1.7] text-foreground/85 rounded-lg px-3.5 py-2.5 border-l-[3px] whitespace-pre-wrap"
            style={{
              background: theme.accentSoft,
              borderColor: theme.accent,
            }}
          >
            {stripMarkdownInline(summary)}
          </div>
        )}

        {/* Figure chain — vertical timeline */}
        {figures.length > 0 && (
          <div className="relative pl-5 mt-2">
            {/* Vertical timeline line */}
            <div
              aria-hidden
              className="absolute left-[7px] top-2 bottom-2 w-[2px]"
              style={{ background: `${theme.accent}40` }}
            />

            <ol className="space-y-2.5">
              {figures.map((fig, idx) => {
                const isLinchpin = fig.isLinchpin || fig.label === linchpinFigure;
                return (
                  <li key={fig.id} className="relative">
                    {/* Timeline dot */}
                    <div
                      aria-hidden
                      className="absolute left-[-19px] top-3 w-[12px] h-[12px] rounded-full border-2 border-white dark:border-slate-900 shadow-sm"
                      style={{
                        background: isLinchpin ? "#C8556C" : theme.accent,
                        boxShadow: isLinchpin
                          ? "0 0 0 3px rgba(200, 85, 108, 0.2)"
                          : "none",
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => onFigureClick?.(fig.label)}
                      className="w-full text-left rounded-lg border border-border/60 bg-white dark:bg-slate-900 hover:shadow-md hover:border-foreground/20 transition-all px-3.5 py-2.5"
                      style={
                        isLinchpin
                          ? { borderColor: "#C8556C", boxShadow: "0 0 0 1px #C8556C40" }
                          : undefined
                      }
                    >
                      {/* Header row: label + badges */}
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span
                          className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded text-white"
                          style={{ background: isLinchpin ? "#C8556C" : theme.accent }}
                        >
                          {fig.label}
                        </span>
                        {isLinchpin && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                            命门
                          </span>
                        )}
                        {fig.chainIndex != null && (
                          <span className="text-[9px] text-muted-foreground">
                            第 {fig.chainIndex} 环
                          </span>
                        )}
                        {fig.panelCount > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            · panels A–{String.fromCharCode(64 + fig.panelCount)}
                          </span>
                        )}
                        {fig.pageIndex > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            · p.{fig.pageIndex}
                          </span>
                        )}
                      </div>
                      {/* Question */}
                      {fig.question ? (
                        <div className="text-[12px] leading-snug text-foreground/85 flex items-start gap-1.5">
                          <span
                            className="text-[10px] font-bold flex-shrink-0 mt-0.5"
                            style={{ color: theme.accent }}
                          >
                            Q
                          </span>
                          <span className="flex-1 whitespace-pre-wrap">{stripMarkdownInline(fig.question)}</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-muted-foreground/70 italic">
                          {stripMarkdownInline(fig.caption).slice(0, 200)}
                          {fig.caption.length > 200 ? "…" : ""}
                        </div>
                      )}
                      {/* Footer hint */}
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
                        <span>点击查看完整图注与逻辑层级</span>
                        <ArrowRight className="h-2.5 w-2.5" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Limits & Opportunities section (special: pairs grid) ──────────────────

function LimitsOpportunitiesSection({
  theme,
  summary,
  detail,
  pairs,
  onChildClick,
}: {
  theme: typeof SECTION_THEME[SectionKey];
  summary?: string;
  detail?: string;
  pairs: Array<{ limitation: string; opportunity: string }>;
  onChildClick: (child: OutlineChild, section: OutlineSection) => void;
}) {
  const Icon = theme.icon;

  return (
    <section
      className="relative rounded-2xl border bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      style={{ borderColor: theme.accentBorder }}
    >
      <div
        aria-hidden
        className="h-1.5"
        style={{ background: theme.accent }}
      />

      <header
        className="px-6 pt-5 pb-3 flex items-start gap-3"
        style={{ background: theme.accentSoft }}
      >
        <div
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-sm"
          style={{ background: theme.accent }}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] font-bold tracking-[0.15em] mb-0.5"
            style={{ color: theme.accent }}
          >
            SECTION {theme.label}
          </div>
          <h2 className="text-[18px] font-semibold text-foreground leading-tight">
            {theme.title}
          </h2>
          {pairs.length > 0 && (
            <p className="text-[10.5px] text-muted-foreground mt-1">
              {pairs.length} 组「局限 → 机会」对照
            </p>
          )}
        </div>
      </header>

      <div className="px-6 py-4 space-y-3.5">
        {/* Summary callout */}
        {summary && (
          <div
            className="text-[13px] leading-[1.7] text-foreground/85 rounded-lg px-3.5 py-2.5 border-l-[3px] whitespace-pre-wrap"
            style={{
              background: theme.accentSoft,
              borderColor: theme.accent,
            }}
          >
            {stripMarkdownInline(summary)}
          </div>
        )}

        {/* Pairs grid — two-column on wider screens */}
        {pairs.length > 0 && (
          <div className="space-y-2">
            {pairs.map((p, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden"
              >
                <div className="flex items-start gap-2 px-3 py-2 border-b border-border/40">
                  <span className="flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold text-white flex items-center justify-center mt-0.5" style={{ background: "#C8556C" }}>
                    L{i + 1}
                  </span>
                  <div className="flex-1 min-w-0 text-[12px] leading-snug text-foreground/85 whitespace-pre-wrap">
                    {stripMarkdownInline(p.limitation)}
                  </div>
                </div>
                <div className="flex items-start gap-2 px-3 py-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded text-[10px] text-white flex items-center justify-center mt-0.5" style={{ background: theme.accent }}>
                    <ArrowRight className="h-2.5 w-2.5" />
                  </span>
                  <div className="flex-1 min-w-0 text-[12px] leading-snug text-muted-foreground whitespace-pre-wrap">
                    {stripMarkdownInline(p.opportunity)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fallback: render raw detail markdown if no pairs */}
        {pairs.length === 0 && detail && (
          <div className="chat-markdown text-[12.5px] leading-[1.7] text-foreground/85">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {detail}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </section>
  );
}
