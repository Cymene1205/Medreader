"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowRight, FileText, Sparkles, MessageSquareQuote, Github } from "lucide-react";

export function Hero() {
  const { data: session, status } = useSession();
  // v2.0 解耦式架构：未登录主 CTA 指向 /login（登录是入口），
  // 而不是 /register（注册是次选，登录页有"注册"链接）。
  const primaryHref = status === "loading" ? "/login" : session?.user ? "/app" : "/login";
  const primaryLabel = session?.user ? "进入工作台" : "立即开始阅读";
  return (
    <section
      id="top"
      className="relative paper-bg pt-28 lg:pt-32 pb-20 lg:pb-28 overflow-hidden"
    >
      {/* 顶部期刊式刊头条 */}
      <div className="absolute top-16 left-0 right-0 border-y border-[var(--rule)] bg-[var(--paper-soft)]/60">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-2 flex items-center justify-between font-sans-ui text-[10px] tracking-[0.22em] uppercase text-[var(--ink-muted)]">
          <span>ISSN 2026-MDR · An AI Reading Agent for Medical Literature</span>
          <span className="hidden md:inline">Huazhong UST · Tongji Medical College</span>
          <span>№ 001 · First Edition</span>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 pt-12 lg:pt-16">
        <div className="grid grid-cols-12 gap-6 lg:gap-10">
          {/* 左侧 — 主标题区 */}
          <div className="col-span-12 lg:col-span-8 fade-up">
            <div className="flex items-center gap-3 mb-6">
              <span className="scholarly-chip">
                <Sparkles className="w-3 h-3" />
                AI-Powered · Open Source
              </span>
              <span className="font-serif-en italic text-sm text-[var(--ink-muted)]">
                A scholarly reading companion
              </span>
            </div>

            <h1 className="hero-title text-[64px] md:text-[88px] lg:text-[112px] text-[var(--ink)] mb-2">
              MedReader
            </h1>
            <h1 className="hero-title-en italic text-[40px] md:text-[56px] lg:text-[72px] text-[var(--burgundy)] mb-8">
              Agent<span className="text-[var(--ink)] not-italic">.</span>
            </h1>

            <div className="ornament-rule my-8 max-w-md">
              <span className="font-serif-en italic text-sm">Est. MMXXVI</span>
            </div>

            <p className="font-serif-cn text-xl md:text-2xl lg:text-[26px] leading-relaxed text-[var(--ink-soft)] max-w-2xl">
              让 AI 帮你真正<span className="text-[var(--burgundy)] font-semibold">读懂</span>一篇医学文献。
              <br />
              五面板协同 · 六维度结构化分析 · 深度问答
            </p>

            <p className="font-serif-en italic text-base text-[var(--ink-muted)] mt-6 max-w-xl leading-relaxed">
              “Turning dense medical PDFs into a navigable, conversational,
              and critique-ready knowledge base.”
            </p>

            {/* CTA */}
            <div className="flex flex-wrap items-center gap-3 mt-10">
              <Link
                href={primaryHref}
                className="group inline-flex items-center gap-2 px-6 py-3.5 bg-[var(--burgundy)] text-[var(--paper)] font-sans-ui text-sm tracking-[0.08em] uppercase rounded-sm hover:bg-[var(--burgundy-deep)] transition-all shadow-md hover:shadow-lg"
              >
                {primaryLabel}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="https://github.com/Cymene1205/Medreader"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3.5 bg-transparent text-[var(--ink)] font-sans-ui text-sm tracking-[0.08em] uppercase border border-[var(--ink)] rounded-sm hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-all"
              >
                <Github className="w-4 h-4" />
                GitHub
              </a>
              <a
                href="#features"
                className="inline-flex items-center gap-2 px-3 py-3.5 font-serif-en italic text-sm text-[var(--burgundy)] hover:underline underline-offset-4"
              >
                浏览功能 ↘
              </a>
            </div>

            {/* 关键数字带 */}
            <div className="mt-14 grid grid-cols-3 gap-4 lg:gap-8 max-w-2xl border-t border-b border-[var(--rule)] py-6">
              {[
                { num: "05", label: "协同面板", en: "Panels" },
                { num: "06", label: "分析维度", en: "Dimensions" },
                { num: "∞", label: "可问问题", en: "Queries" },
              ].map((s) => (
                <div key={s.label} className="text-center lg:text-left">
                  <div className="numeral text-4xl lg:text-5xl">{s.num}</div>
                  <div className="font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)] mt-1">
                    {s.label} · <span className="font-serif-en italic">{s.en}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧 — 期刊式装饰版 */}
          <div className="col-span-12 lg:col-span-4 relative">
            <div className="relative h-full min-h-[480px] hidden lg:block">
              {/* 主装饰卡 — 五面板预览 */}
              <div className="absolute inset-0 float-slow">
                <div className="scholarly-card p-5 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--rule)]">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[var(--burgundy)]" />
                      <span className="font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-soft)]">
                        Five-Panel Workspace
                      </span>
                    </div>
                    <span className="font-serif-en italic text-[10px] text-[var(--ink-muted)]">
                      Fig. 1
                    </span>
                  </div>

                  {/* 五面板缩略图 */}
                  <div className="grid grid-cols-6 grid-rows-3 gap-1.5 flex-1">
                    <div className="mini-panel col-span-2 row-span-3 rounded-sm overflow-hidden flex flex-col">
                      <div className="mini-panel-bar"><span /><span /><span /></div>
                      <div className="p-1.5 space-y-1">
                        <div className="h-1.5 w-3/4 bg-[var(--burgundy)]/30 rounded-sm" />
                        <div className="h-1 w-full bg-[var(--rule)]" />
                        <div className="h-1 w-full bg-[var(--rule)]" />
                        <div className="h-1 w-2/3 bg-[var(--rule)]" />
                        <div className="h-1 w-full bg-[var(--rule)]" />
                        <div className="h-1 w-1/2 bg-[var(--rule)]" />
                      </div>
                    </div>
                    <div className="mini-panel col-span-2 row-span-2 rounded-sm overflow-hidden flex flex-col">
                      <div className="mini-panel-bar"><span /><span /><span /></div>
                      <div className="p-1.5 grid grid-cols-2 gap-1">
                        <div className="h-2 bg-[var(--moss)]/30 rounded-sm" />
                        <div className="h-2 bg-[var(--burgundy)]/30 rounded-sm" />
                        <div className="h-2 bg-[var(--gold)]/30 rounded-sm" />
                        <div className="h-2 bg-[var(--moss-soft)]/30 rounded-sm" />
                      </div>
                    </div>
                    <div className="mini-panel col-span-2 row-span-2 rounded-sm overflow-hidden flex flex-col">
                      <div className="mini-panel-bar"><span /><span /><span /></div>
                      <div className="p-1.5 flex items-center justify-center">
                        <div className="relative w-10 h-10">
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--burgundy)]" />
                          <div className="absolute top-3 left-0 w-2 h-2 rounded-full bg-[var(--moss)]" />
                          <div className="absolute top-3 right-0 w-2 h-2 rounded-full bg-[var(--gold)]" />
                          <div className="absolute bottom-0 left-1/4 w-1.5 h-1.5 rounded-full bg-[var(--burgundy-soft)]" />
                          <div className="absolute bottom-0 right-1/4 w-1.5 h-1.5 rounded-full bg-[var(--moss-soft)]" />
                          <svg className="absolute inset-0" viewBox="0 0 40 40">
                            <line x1="20" y1="2" x2="6" y2="14" stroke="var(--rule)" strokeWidth="0.5" />
                            <line x1="20" y1="2" x2="34" y2="14" stroke="var(--rule)" strokeWidth="0.5" />
                            <line x1="6" y1="14" x2="10" y2="36" stroke="var(--rule)" strokeWidth="0.5" />
                            <line x1="34" y1="14" x2="30" y2="36" stroke="var(--rule)" strokeWidth="0.5" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    <div className="mini-panel col-span-2 row-span-1 rounded-sm overflow-hidden">
                      <div className="mini-panel-bar"><span /><span /><span /></div>
                    </div>
                    <div className="mini-panel col-span-2 row-span-1 rounded-sm overflow-hidden">
                      <div className="mini-panel-bar"><span /><span /><span /></div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-[var(--rule)] flex items-center gap-2">
                    <MessageSquareQuote className="w-3.5 h-3.5 text-[var(--burgundy)]" />
                    <span className="font-serif-en italic text-[11px] text-[var(--ink-muted)]">
                      Resizable · Synchronized · Conversational
                    </span>
                  </div>
                </div>
              </div>

              {/* 装饰角标 */}
              <div className="absolute -top-3 -right-3 w-14 h-14 bg-[var(--burgundy)] text-[var(--paper)] flex items-center justify-center rounded-sm shadow-md rotate-3">
                <div className="text-center">
                  <div className="font-serif-en italic text-[9px] leading-none">Vol.</div>
                  <div className="font-serif-en font-bold text-xl leading-none mt-0.5">I</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部脚注式提示 */}
        <div className="mt-20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-[var(--ink-muted)]">
          <p className="font-serif-en italic text-sm">
            ↓ Scroll to read the prospectus · 向下滚动阅读项目说明书
          </p>
          <p className="font-sans-ui text-[10px] tracking-[0.2em] uppercase">
            Curated by Chen Yumo · Tongji Med
          </p>
        </div>
      </div>
    </section>
  );
}
