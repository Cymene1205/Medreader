"use client";

import { ArrowRight, Github, Server, FileText } from "lucide-react";

export function CTA() {
  return (
    <section
      id="cta"
      className="relative py-24 lg:py-32 border-t border-[var(--rule)] overflow-hidden"
      style={{ background: "var(--burgundy-deep)" }}
    >
      {/* 装饰性纹理 */}
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, var(--paper) 0%, transparent 35%), radial-gradient(circle at 80% 80%, var(--gold) 0%, transparent 35%)",
        }}
      />
      {/* 装饰大字 */}
      <div className="absolute -top-10 right-0 lg:right-10 font-serif-en italic font-bold text-[12rem] lg:text-[18rem] leading-none text-[var(--paper)] opacity-[0.05] pointer-events-none">
        Fin.
      </div>

      <div className="relative max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-8 items-center">
          <div className="col-span-12 lg:col-span-7">
            <div className="flex items-center gap-3 mb-6">
              <span className="font-serif-en italic text-xs tracking-[0.2em] uppercase text-[var(--gold)]">
                § VIII. Coda · 结语
              </span>
            </div>
            <h2 className="font-serif-cn text-3xl md:text-5xl lg:text-6xl font-semibold text-[var(--paper)] leading-[1.15] mb-6">
              把今天的那篇文献，
              <br />
              交给一位 AI 阅读伙伴。
            </h2>
            <p className="font-serif-cn text-lg text-[var(--paper)]/80 leading-relaxed max-w-2xl mb-2">
              MedReader Agent 已开放源代码，可在你的服务器上一键部署。
            </p>
            <p className="font-serif-en italic text-sm text-[var(--gold)]">
              Open source · Self-hostable · Built for medical researchers.
            </p>
          </div>

          <div className="col-span-12 lg:col-span-5">
            <div className="space-y-3">
              <a
                href="#top"
                className="group flex items-center justify-between gap-4 px-6 py-5 bg-[var(--paper)] text-[var(--burgundy-deep)] rounded-sm hover:bg-[var(--gold)] hover:text-[var(--burgundy-deep)] transition-colors shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5" />
                  <div>
                    <div className="font-sans-ui text-sm tracking-[0.1em] uppercase font-semibold">
                      立即开始阅读
                    </div>
                    <div className="font-serif-en italic text-xs opacity-70">
                      Try the live demo
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>

              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between gap-4 px-6 py-5 bg-transparent text-[var(--paper)] border border-[var(--paper)]/40 rounded-sm hover:bg-[var(--paper)]/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Github className="w-5 h-5" />
                  <div>
                    <div className="font-sans-ui text-sm tracking-[0.1em] uppercase font-semibold">
                      GitHub 仓库
                    </div>
                    <div className="font-serif-en italic text-xs opacity-70">
                      Source code · MIT License
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>

              <a
                href="#stack"
                className="group flex items-center justify-between gap-4 px-6 py-5 bg-transparent text-[var(--paper)] border border-[var(--paper)]/40 rounded-sm hover:bg-[var(--paper)]/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5" />
                  <div>
                    <div className="font-sans-ui text-sm tracking-[0.1em] uppercase font-semibold">
                      自托管部署
                    </div>
                    <div className="font-serif-en italic text-xs opacity-70">
                      Docker Compose · 2 vCPU / 2 GiB
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
