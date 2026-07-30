"use client";

import {
  FileText,
  FileSearch,
  Network,
  MessageSquareQuote,
  LayoutGrid,
  ListTree,
  ArrowUpRight,
} from "lucide-react";

const PANELS = [
  {
    id: "01",
    icon: FileText,
    title: "PDF 原文阅读",
    en: "Original PDF Viewer",
    desc:
      "高保真渲染 PDF 原文，保留版式、图表与公式。支持选词高亮、跨页滚动、缩放与页面跳转。所有原文内容皆可被选中和复制，作为后续提问与笔记的源头。",
    points: ["原生 PDF 渲染", "选词高亮 / 跨页定位", "图表 / 公式保真"],
    span: "lg:col-span-7",
    accent: "burgundy",
  },
  {
    id: "02",
    icon: FileSearch,
    title: "智能解析",
    en: "Structured Markdown",
    desc:
      "MinerU Cloud 将 PDF 转换为结构化 Markdown：标题、段落、公式、表格、图片分块呈现。每一块都可点击、可复制、可作为提问上下文。",
    points: ["MinerU Cloud API", "图文公式分块", "段落级定位"],
    span: "lg:col-span-5",
    accent: "moss",
  },
  {
    id: "03",
    icon: Network,
    title: "思维导图",
    en: "Mind Map",
    desc:
      "基于标题层级自动生成可交互思维导图，论文骨架一目了然。支持节点展开折叠、点击跳转原文、Dagre 自动布局。",
    points: ["自动层级识别", "Dagre 自动布局", "节点跳转原文"],
    span: "lg:col-span-4",
    accent: "gold",
  },
  {
    id: "04",
    icon: MessageSquareQuote,
    title: "Agent 提问",
    en: "Conversational Agent",
    desc:
      "DeepSeek 大模型驱动的对话面板。支持选中文本提问、附图提问、整篇追问。所有回答可溯源到原文段落，避免幻觉。",
    points: ["DeepSeek 大模型", "选段 / 附图提问", "回答可溯源"],
    span: "lg:col-span-4",
    accent: "burgundy",
  },
  {
    id: "05",
    icon: LayoutGrid,
    title: "全文框架",
    en: "Outline & Navigation",
    desc:
      "AI 基于正文上下文自动识别章节结构（区分正文与期刊样板），生成可折叠的全文框架。下方段落导航按颜色区分章节，点击即可在原文中跳转高亮。",
    points: ["AI 章节识别", "段落彩色导航", "双向联动定位"],
    span: "lg:col-span-4",
    accent: "moss",
  },
];

const ACCENT = {
  burgundy: {
    bg: "bg-[var(--burgundy)]",
    soft: "bg-[var(--burgundy)]/8",
    text: "text-[var(--burgundy)]",
    border: "border-[var(--burgundy)]",
  },
  moss: {
    bg: "bg-[var(--moss)]",
    soft: "bg-[var(--moss)]/8",
    text: "text-[var(--moss)]",
    border: "border-[var(--moss)]",
  },
  gold: {
    bg: "bg-[var(--gold)]",
    soft: "bg-[var(--gold)]/10",
    text: "text-[var(--gold)]",
    border: "border-[var(--gold)]",
  },
} as const;

export function Features() {
  return (
    <section
      id="features"
      className="paper-bg py-20 lg:py-28 border-t border-[var(--rule)]"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-12">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ II.</div>
            <div className="journal-heading-en text-sm">Featured Columns / 核心功能</div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              五面板协同的阅读工作区
            </h2>
            <p className="font-serif-cn text-[var(--ink-soft)] text-lg leading-relaxed max-w-3xl">
              不是五个独立的工具，而是一个连贯的阅读流：从原文到解析、从解析到导图、从导图到提问、从提问回到原文。
              <span className="font-serif-en italic text-[var(--ink-muted)]">
                {" "}— Five panels, one conversation.
              </span>
            </p>
          </div>
        </div>

        {/* 五面板网格 */}
        <div className="grid grid-cols-12 gap-5 lg:gap-6">
          {PANELS.map((p, i) => {
            const a = ACCENT[p.accent as keyof typeof ACCENT];
            return (
              <article
                key={p.id}
                className={`scholarly-card ${p.span} col-span-12 p-7 lg:p-8 flex flex-col group fade-up`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 ${a.soft} ${a.text} flex items-center justify-center rounded-sm border ${a.border}`}
                    >
                      <p.icon className="w-5 h-5" strokeWidth={2} />
                    </div>
                    <div>
                      <div className={`numeral text-2xl leading-none ${a.text}`}>
                        {p.id}
                      </div>
                      <div className="font-serif-en italic text-[10px] tracking-wide text-[var(--ink-muted)] mt-1">
                        Panel № {p.id}
                      </div>
                    </div>
                  </div>
                  <ArrowUpRight
                    className={`w-4 h-4 ${a.text} opacity-40 group-hover:opacity-100 transition-opacity`}
                  />
                </div>

                <h3 className="journal-heading text-2xl mb-1">{p.title}</h3>
                <p className={`font-serif-en italic text-sm ${a.text} mb-4`}>
                  {p.en}
                </p>

                <p className="font-serif-cn text-[15px] leading-[1.85] text-[var(--ink-soft)] mb-6 flex-1">
                  {p.desc}
                </p>

                <div className="flex flex-wrap gap-2 pt-4 border-t border-dotted border-[var(--rule)]">
                  {p.points.map((pt) => (
                    <span
                      key={pt}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 ${a.soft} ${a.text} font-sans-ui text-[10px] tracking-[0.1em] uppercase rounded-sm`}
                    >
                      <span className={`w-1 h-1 rounded-full ${a.bg}`} />
                      {pt}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        {/* 联动说明 */}
        <div className="mt-14 grid grid-cols-12 gap-6 border-t border-[var(--rule)] pt-10">
          <div className="col-span-12 lg:col-span-4">
            <div className="flex items-center gap-2 mb-3">
              <ListTree className="w-4 h-4 text-[var(--burgundy)]" />
              <span className="font-sans-ui text-[10px] tracking-[0.2em] uppercase text-[var(--burgundy)]">
                Bidirectional Sync · 双向联动
              </span>
            </div>
            <h3 className="journal-heading text-2xl">
              所有面板共享同一个上下文
            </h3>
          </div>
          <div className="col-span-12 lg:col-span-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[
                {
                  from: "全文框架",
                  to: "PDF 原文",
                  desc: "点击章节标题，左侧 PDF 自动滚动到对应位置并高亮。",
                },
                {
                  from: "原文选段",
                  to: "Agent 提问",
                  desc: "在 PDF 选中任意文字，右侧 Agent 即刻以该段为上下文回答。",
                },
                {
                  from: "思维导图节点",
                  to: "智能解析",
                  desc: "导图节点点击后，中间解析面板跳转到对应章节。",
                },
              ].map((s, i) => (
                <div
                  key={i}
                  className="p-5 bg-[var(--paper-soft)] border border-[var(--rule)] rounded-sm"
                >
                  <div className="flex items-center gap-2 mb-3 font-sans-ui text-[11px] tracking-[0.1em]">
                    <span className="px-2 py-0.5 bg-[var(--burgundy)] text-[var(--paper)] rounded-sm">
                      {s.from}
                    </span>
                    <span className="text-[var(--ink-muted)]">→</span>
                    <span className="px-2 py-0.5 bg-[var(--moss)] text-[var(--paper)] rounded-sm">
                      {s.to}
                    </span>
                  </div>
                  <p className="font-serif-cn text-sm text-[var(--ink-soft)] leading-relaxed">
                    {s.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
