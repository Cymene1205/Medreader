"use client";

import {
  Search,
  PenLine,
  GraduationCap,
  Users,
  LibraryBig,
  ClipboardCheck,
} from "lucide-react";

const SCENES = [
  {
    icon: Search,
    title: "文献调研",
    en: "Literature Review",
    body:
      "进入新课题时，快速建立领域地图。用思维导图扫读十篇综述，用 Agent 提问锁定核心争论，用全文框架对比方法论差异。",
    color: "var(--burgundy)",
    soft: "rgba(107,39,55,0.06)",
  },
  {
    icon: PenLine,
    title: "论文写作",
    en: "Paper Writing",
    body:
      `在 Introduction 与 Discussion 之间反复横跳时，用六维度分析提醒自己「局限性」是否被诚实陈述；用 Agent 帮你重写一段更紧凑的论述。`,
    color: "var(--moss)",
    soft: "rgba(45,74,62,0.06)",
  },
  {
    icon: GraduationCap,
    title: "教学辅助",
    en: "Teaching Aid",
    body:
      "准备组会汇报或课程讲义时，把核心论文上传到 MedReader，导出思维导图作为讲义骨架，用 Agent 提前演练可能被学生问到的问题。",
    color: "var(--gold)",
    soft: "rgba(168,139,62,0.08)",
  },
  {
    icon: Users,
    title: "组会汇报",
    en: "Journal Club",
    body:
      `每周组会精读一篇文献，把 PDF 上传后让 Agent 提前帮你生成「科学问题—方法—结果—局限」四段式摘要，汇报时按框架展开。`,
    color: "var(--burgundy-deep)",
    soft: "rgba(74,26,38,0.06)",
  },
  {
    icon: LibraryBig,
    title: "综述撰写",
    en: "Review Synthesis",
    body:
      `撰写综述时累积数十篇文献的结构化分析，按主题聚类对比「科学问题」与「创新性」维度，找出研究空白与潜在切入点。`,
    color: "var(--moss-soft)",
    soft: "rgba(74,107,93,0.06)",
  },
  {
    icon: ClipboardCheck,
    title: "同行评议",
    en: "Peer Review",
    body:
      `审稿时用六维度框架逐项核对——尤其是「论证逻辑解析」与「局限性」——确保自己没有遗漏作者回避的关键问题。`,
    color: "var(--burgundy-soft)",
    soft: "rgba(142,58,77,0.06)",
  },
];

export function UseCases() {
  return (
    <section
      id="usecases"
      className="paper-bg py-20 lg:py-28 border-t border-[var(--rule)]"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ VI.</div>
            <div className="journal-heading-en text-sm">Use Cases / 应用场景</div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              为研究者全流程而设计
            </h2>
            <p className="font-serif-cn text-[var(--ink-soft)] text-lg leading-relaxed max-w-3xl">
              从入门一个新课题，到撰写自己的论文；从准备一次组会，到审一篇同行评议——
              MedReader Agent 都能成为你的第二位阅读伙伴。
            </p>
          </div>
        </div>

        {/* 场景网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {SCENES.map((s, i) => (
            <article
              key={s.title}
              className="scholarly-card p-7 lg:p-8 flex flex-col fade-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div
                className="w-14 h-14 flex items-center justify-center rounded-sm mb-5 border"
                style={{
                  background: s.soft,
                  borderColor: s.color,
                  color: s.color,
                }}
              >
                <s.icon className="w-6 h-6" strokeWidth={1.8} />
              </div>

              <div className="flex items-baseline gap-2 mb-1">
                <span className="numeral text-sm" style={{ color: s.color }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="journal-heading text-xl">{s.title}</h3>
              </div>
              <p
                className="font-serif-en italic text-xs mb-4"
                style={{ color: s.color }}
              >
                {s.en}
              </p>

              <p className="font-serif-cn text-[15px] leading-[1.85] text-[var(--ink-soft)] flex-1">
                {s.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
