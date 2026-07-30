"use client";

import { Microscope, GitBranch, FlaskConical, Workflow, Lightbulb, AlertTriangle } from "lucide-react";

const DIMENSIONS = [
  {
    id: "01",
    name: "科学问题",
    en: "Research Question",
    desc:
      "这篇论文究竟想回答什么问题？问题从何而来？是否足够新颖、足够重要？",
    icon: Microscope,
    card: "dim-card-1",
    question: "What is being asked, and why does it matter?",
  },
  {
    id: "02",
    name: "论证思路",
    en: "Argumentation Logic",
    desc:
      "作者用什么样的逻辑链来回答问题？从前提到结论有几步？哪些步骤是关键假设？",
    icon: GitBranch,
    card: "dim-card-2",
    question: "How does the author chain evidence to claim?",
  },
  {
    id: "03",
    name: "实验方法与结果",
    en: "Methods & Results",
    desc:
      "用了什么实验/计算方法？数据规模、对照设置、统计检验是否合理？关键结果有哪些？",
    icon: FlaskConical,
    card: "dim-card-3",
    question: "What was done, and what was found?",
  },
  {
    id: "04",
    name: "论证逻辑解析",
    en: "Logic Decoding",
    desc:
      "结果是否真的支持结论？是否存在过度推断、混淆变量、循环论证？反例与替代解释是什么？",
    icon: Workflow,
    card: "dim-card-4",
    question: "Do the results truly entail the claims?",
  },
  {
    id: "05",
    name: "创新性",
    en: "Novelty",
    desc:
      "相比已有工作，新在哪里——是问题新、方法新、还是证据新？创新程度是渐进式还是范式级？",
    icon: Lightbulb,
    card: "dim-card-5",
    question: "What is genuinely new here?",
  },
  {
    id: "06",
    name: "局限性",
    en: "Limitations",
    desc:
      "样本、方法、推广性、可重复性方面的局限是什么？哪些下一步工作能弥补这些不足？",
    icon: AlertTriangle,
    card: "dim-card-6",
    question: "Where does this work stop short?",
  },
];

export function Dimensions() {
  return (
    <section
      id="dimensions"
      className="relative py-20 lg:py-28 border-t border-[var(--rule)] overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, var(--paper) 0%, var(--paper-dark) 100%)",
      }}
    >
      {/* 装饰性背景文字 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.025]">
        <span className="font-serif-en italic text-[28rem] font-bold text-[var(--burgundy)] leading-none">
          VI
        </span>
      </div>

      <div className="relative max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ III.</div>
            <div className="journal-heading-en text-sm">
              Six Dimensions / 六维度分析
            </div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              像同行评议一样拆解一篇论文
            </h2>
            <p className="font-serif-cn text-[var(--ink-soft)] text-lg leading-relaxed max-w-3xl">
              Agent 主动从六个核心维度对论文进行结构化分析——不是简单摘要，而是接近审稿深度的二次解读。每个维度都附带关键追问，便于读者带着问题回到原文。
            </p>
          </div>
        </div>

        {/* 六维度网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
          {DIMENSIONS.map((d, i) => (
            <article
              key={d.id}
              className="group relative overflow-hidden rounded-sm border border-[var(--rule)] bg-[var(--paper-soft)] fade-up"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              {/* 顶部色带 */}
              <div className={`${d.card} h-32 p-5 flex items-start justify-between text-white relative overflow-hidden`}>
                <div className="relative z-10">
                  <div className="font-serif-en italic text-xs opacity-80">
                    Dimension № {d.id}
                  </div>
                  <div className="font-serif-cn text-2xl font-semibold mt-1">
                    {d.name}
                  </div>
                  <div className="font-serif-en italic text-sm opacity-80 mt-0.5">
                    {d.en}
                  </div>
                </div>
                <div className="relative z-10 w-11 h-11 rounded-sm bg-white/15 backdrop-blur flex items-center justify-center">
                  <d.icon className="w-5 h-5" strokeWidth={1.8} />
                </div>
                {/* 装饰编号大字 */}
                <div className="absolute -bottom-4 -right-2 font-serif-en italic font-bold text-[7rem] leading-none opacity-15">
                  {d.id}
                </div>
              </div>

              {/* 主体 */}
              <div className="p-5">
                <p className="font-serif-cn text-sm leading-[1.8] text-[var(--ink-soft)] mb-4">
                  {d.desc}
                </p>
                <div className="pt-3 border-t border-dotted border-[var(--rule)]">
                  <div className="font-sans-ui text-[9px] tracking-[0.18em] uppercase text-[var(--ink-muted)] mb-1">
                    Key Question
                  </div>
                  <p className="font-serif-en italic text-sm text-[var(--burgundy)] leading-snug">
                    &ldquo;{d.question}&rdquo;
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* 底部说明 */}
        <div className="mt-14 grid grid-cols-12 gap-6 border-t border-[var(--rule)] pt-8">
          <div className="col-span-12 lg:col-span-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="scholarly-chip">Auto-Generated</span>
            </div>
            <p className="font-serif-cn text-[15px] leading-relaxed text-[var(--ink-soft)]">
              六维度分析由 Agent 基于论文正文自动生成，分析结果嵌入"全文框架"面板，
              每条分析都可点击跳转到原文对应段落，便于读者复核与质疑。
            </p>
          </div>
          <div className="col-span-12 lg:col-span-6 lg:border-l lg:border-[var(--rule)] lg:pl-12">
            <div className="flex items-center gap-2 mb-2">
              <span className="scholarly-chip" style={{ color: "var(--moss)", borderColor: "var(--moss)", background: "rgba(45,74,62,0.05)" }}>
                Source-Aware
              </span>
            </div>
            <p className="font-serif-cn text-[15px] leading-relaxed text-[var(--ink-soft)]">
              分析过程基于 MinerU 解析后的结构化正文，而非原始 PDF 文本层。
              标题层级、表格、公式、图表说明均被作为上下文传入，避免幻觉与断章取义。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
