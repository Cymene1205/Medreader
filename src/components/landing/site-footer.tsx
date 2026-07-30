"use client";

import { BookMarked } from "lucide-react";

export function SiteFooter() {
  return (
    <footer
      className="paper-bg border-t-2 border-[var(--ink)]"
      style={{ marginTop: "auto" }}
    >
      {/* 期刊式刊尾 */}
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-14">
        <div className="grid grid-cols-12 gap-8">
          {/* Brand 列 */}
          <div className="col-span-12 md:col-span-5 lg:col-span-4">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-9 h-9 rounded-sm bg-[var(--burgundy)] text-[var(--paper)] flex items-center justify-center">
                <BookMarked className="w-4 h-4" strokeWidth={2.2} />
              </span>
              <div>
                <div className="font-serif-en text-[15px] font-semibold text-[var(--ink)]">
                  MedReader <span className="italic text-[var(--burgundy)]">Agent</span>
                </div>
                <div className="font-sans-ui text-[9px] tracking-[0.22em] uppercase text-[var(--ink-muted)]">
                  Vol. I · 2026 · First Edition
                </div>
              </div>
            </div>
            <p className="font-serif-cn text-sm leading-[1.85] text-[var(--ink-soft)] max-w-md mb-4">
              一个面向医学研究者的 AI 文献阅读 Agent。让 PDF 不再是孤岛，
              让阅读不再是一个人的劳作。
            </p>
            <p className="font-serif-en italic text-xs text-[var(--ink-muted)]">
              “Reading, decoded.”
            </p>
          </div>

          {/* 链接列 */}
          <div className="col-span-6 md:col-span-3 lg:col-span-2">
            <div className="font-sans-ui text-[10px] tracking-[0.2em] uppercase text-[var(--burgundy)] mb-3 pb-2 border-b border-[var(--rule)]">
              项目
            </div>
            <ul className="space-y-2">
              {[
                { label: "概览", href: "#overview" },
                { label: "核心功能", href: "#features" },
                { label: "六维分析", href: "#dimensions" },
                { label: "工作流", href: "#workflow" },
              ].map((it) => (
                <li key={it.href}>
                  <a
                    href={it.href}
                    className="font-serif-cn text-sm text-[var(--ink-soft)] hover:text-[var(--burgundy)] transition-colors"
                  >
                    {it.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-6 md:col-span-2 lg:col-span-2">
            <div className="font-sans-ui text-[10px] tracking-[0.2em] uppercase text-[var(--burgundy)] mb-3 pb-2 border-b border-[var(--rule)]">
              资源
            </div>
            <ul className="space-y-2">
              {[
                { label: "技术架构", href: "#stack" },
                { label: "应用场景", href: "#usecases" },
                { label: "作者", href: "#author" },
                { label: "立即开始", href: "#cta" },
              ].map((it) => (
                <li key={it.href}>
                  <a
                    href={it.href}
                    className="font-serif-cn text-sm text-[var(--ink-soft)] hover:text-[var(--burgundy)] transition-colors"
                  >
                    {it.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-12 md:col-span-2 lg:col-span-4">
            <div className="font-sans-ui text-[10px] tracking-[0.2em] uppercase text-[var(--burgundy)] mb-3 pb-2 border-b border-[var(--rule)]">
              著录信息
            </div>
            <ul className="reference-list space-y-1">
              <li>
                <span className="cite-num">[1]</span> 陈禹墨. MedReader Agent:
                面向医学研究者的 AI 文献阅读 Agent [EB/OL]. 2026.
              </li>
              <li>
                <span className="cite-num">[2]</span> Huazhong University of
                Science and Technology, Tongji Medical College.
              </li>
              <li>
                <span className="cite-num">[3]</span> 公众号「行止集」 ·
                WeChat Channel “Xing Zhi Ji”.
              </li>
              <li>
                <span className="cite-num">[4]</span> Built with Next.js 16 ·
                TypeScript · MinerU Cloud · DeepSeek.
              </li>
            </ul>
          </div>
        </div>

        {/* 版权条 */}
        <div className="mt-12 pt-6 border-t border-[var(--rule)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <p className="font-sans-ui text-[11px] tracking-[0.1em] text-[var(--ink-muted)]">
            © 2026 MedReader Agent · MIT License · 由陈禹墨设计与开发
          </p>
          <p className="font-serif-en italic text-xs text-[var(--ink-muted)]">
            Set in EB Garamond × Noto Serif SC · Printed digitally.
          </p>
        </div>
      </div>
    </footer>
  );
}
