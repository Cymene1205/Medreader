"use client";

import { Upload, Cpu, BrainCircuit, MessagesSquare } from "lucide-react";

const STEPS = [
  {
    n: "I",
    icon: Upload,
    title: "上传 PDF",
    en: "Upload",
    desc:
      "用户上传医学文献 PDF。系统自动建立独立工作目录，按论文 ID 隔离图片与解析产物。",
    detail: ["文件大小 ≤ 50MB", "支持中英文", "自动去重 hash"],
  },
  {
    n: "II",
    icon: Cpu,
    title: "MinerU 解析",
    en: "Parse",
    desc:
      "调用 MinerU Cloud API 将 PDF 转换为结构化 Markdown：识别标题层级、公式、表格、图片、参考文献。",
    detail: ["MinerU Cloud API", "Markdown + blocks JSON", "图片单独存盘"],
  },
  {
    n: "III",
    icon: BrainCircuit,
    title: "AI 结构化分析",
    en: "Analyze",
    desc:
      "DeepSeek 基于正文 8000 字符上下文识别章节结构，生成全文框架；并按六维度主动产出分析。",
    detail: ["DeepSeek-V3", "8000 字符上下文", "六维度同步生成"],
  },
  {
    n: "IV",
    icon: MessagesSquare,
    title: "对话与精读",
    en: "Converse",
    desc:
      "用户在五面板工作区中阅读：选段提问、跳转章节、查看导图、回看原文。所有交互双向联动。",
    detail: ["选段 → Agent", "框架 → 原文", "导图 → 解析"],
  },
];

export function Workflow() {
  return (
    <section
      id="workflow"
      className="paper-bg py-20 lg:py-28 border-t border-[var(--rule)]"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ IV.</div>
            <div className="journal-heading-en text-sm">Workflow / 工作流</div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              从 PDF 到可对话知识，只需四步
            </h2>
            <p className="font-serif-cn text-[var(--ink-soft)] text-lg leading-relaxed max-w-3xl">
              上传后约 30–90 秒内完成解析与结构化分析。之后所有阅读、提问、导航均在本地浏览器内进行，
              响应即时。
            </p>
          </div>
        </div>

        {/* 时间线 */}
        <div className="relative">
          {/* 横向连接线（桌面） */}
          <div className="hidden lg:block absolute top-[42px] left-[12.5%] right-[12.5%] h-px bg-[var(--rule)]" />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-10 lg:gap-6">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative fade-up" style={{ animationDelay: `${i * 100}ms` }}>
                {/* 时间线点 */}
                <div className="flex justify-center mb-6">
                  <div className="timeline-dot" />
                </div>

                <div className="text-center">
                  {/* 罗马数字大字 */}
                  <div className="numeral text-5xl mb-3">{s.n}</div>

                  <div className="inline-flex items-center justify-center w-14 h-14 mb-4 bg-[var(--paper-soft)] border border-[var(--burgundy)] text-[var(--burgundy)] rounded-sm">
                    <s.icon className="w-6 h-6" strokeWidth={1.8} />
                  </div>

                  <h3 className="journal-heading text-xl mb-1">{s.title}</h3>
                  <p className="font-serif-en italic text-xs text-[var(--ink-muted)] mb-4">
                    Step {s.n} · {s.en}
                  </p>

                  <p className="font-serif-cn text-sm leading-[1.8] text-[var(--ink-soft)] mb-5 px-2">
                    {s.desc}
                  </p>

                  <ul className="space-y-1.5 inline-block text-left">
                    {s.detail.map((d) => (
                      <li
                        key={d}
                        className="flex items-center gap-2 font-sans-ui text-[11px] text-[var(--ink-soft)]"
                      >
                        <span className="w-1 h-1 rounded-full bg-[var(--burgundy)]" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 时长说明 */}
        <div className="mt-16 border-t border-b border-[var(--rule)] py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { num: "30s", label: "平均解析时长", sub: "Avg. parsing" },
            { num: "150", label: "标题识别上限", sub: "Headings cap" },
            { num: "8K", label: "上下文字符", sub: "Context chars" },
            { num: "6", label: "维度同时产出", sub: "Dimensions" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="numeral text-3xl mb-1">{s.num}</div>
              <div className="font-serif-cn text-sm text-[var(--ink)] font-semibold">
                {s.label}
              </div>
              <div className="font-serif-en italic text-[10px] text-[var(--ink-muted)]">
                {s.sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
