"use client";

import {
  Code2,
  Braces,
  Palette,
  Database,
  Cloud,
  Cpu,
  GitBranch,
  Boxes,
  ShieldCheck,
  Workflow,
  Network,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Layer = {
  layer: string;
  en: string;
  items: { name: string; role: string; icon: LucideIcon }[];
};

const LAYERS: Layer[] = [
  {
    layer: "前端框架",
    en: "Frontend",
    items: [
      { name: "Next.js 16", role: "App Router + RSC", icon: Code2 },
      { name: "TypeScript 5", role: "严格类型", icon: Braces },
      { name: "Tailwind CSS 4", role: "样式系统", icon: Palette },
      { name: "shadcn/ui", role: "组件库 (New York)", icon: Boxes },
    ],
  },
  {
    layer: "数据与状态",
    en: "Data & State",
    items: [
      { name: "Prisma ORM", role: "SQLite 客户端", icon: Database },
      { name: "Zustand", role: "客户端状态", icon: Boxes },
      { name: "TanStack Query", role: "服务端状态", icon: GitBranch },
      { name: "NextAuth.js v4", role: "用户认证", icon: ShieldCheck },
    ],
  },
  {
    layer: "AI / 解析能力",
    en: "AI Capabilities",
    items: [
      { name: "MinerU Cloud", role: "PDF → Markdown", icon: Cloud },
      { name: "DeepSeek-V3", role: "结构化分析 + 对话", icon: Cpu },
      { name: "Dagre", role: "思维导图布局", icon: Network },
      { name: "react-resizable-panels", role: "五面板协同", icon: Workflow },
    ],
  },
];

export function TechStack() {
  return (
    <section
      id="stack"
      className="paper-bg py-20 lg:py-28 border-t border-[var(--rule)]"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ V.</div>
            <div className="journal-heading-en text-sm">
              Technical Architecture / 技术架构
            </div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              一个为长期阅读而设计的技术栈
            </h2>
            <p className="font-serif-cn text-[var(--ink-soft)] text-lg leading-relaxed max-w-3xl">
              全栈 TypeScript + 现代 React。解析能力依托 MinerU Cloud，推理能力依托 DeepSeek，
              所有数据沉淀在本地 SQLite，便于长期累积个人文献库。
            </p>
          </div>
        </div>

        {/* 三层架构 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {LAYERS.map((layer, idx) => (
            <div
              key={layer.layer}
              className="scholarly-card p-7 fade-up"
              style={{ animationDelay: `${idx * 120}ms` }}
            >
              <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-[var(--rule)]">
                <h3 className="journal-heading text-xl">{layer.layer}</h3>
                <span className="font-serif-en italic text-xs text-[var(--ink-muted)]">
                  {layer.en}
                </span>
              </div>

              <ul className="space-y-4">
                {layer.items.map((it) => (
                  <li key={it.name} className="flex items-start gap-3 group">
                    <div className="w-9 h-9 shrink-0 bg-[var(--paper-dark)] border border-[var(--rule)] flex items-center justify-center rounded-sm group-hover:border-[var(--burgundy)] group-hover:bg-[var(--burgundy)]/5 transition-colors">
                      <it.icon
                        className="w-4 h-4 text-[var(--ink-soft)] group-hover:text-[var(--burgundy)] transition-colors"
                        strokeWidth={1.8}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-serif-cn font-semibold text-[15px] text-[var(--ink)]">
                        {it.name}
                      </div>
                      <div className="font-serif-en italic text-xs text-[var(--ink-muted)]">
                        {it.role}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 架构示意 */}
        <div className="mt-10 scholarly-card p-8 lg:p-10">
          <div className="flex items-center gap-3 mb-8">
            <span className="scholarly-chip">System Diagram</span>
            <h3 className="journal-heading text-xl">数据流示意</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-stretch text-center">
            {[
              { name: "PDF 上传", tech: "Browser", color: "var(--ink)" },
              { name: "MinerU 解析", tech: "Cloud API", color: "var(--burgundy)" },
              { name: "结构化存储", tech: "SQLite + FS", color: "var(--moss)" },
              { name: "DeepSeek 分析", tech: "LLM API", color: "var(--gold)" },
              { name: "五面板工作区", tech: "React RSC", color: "var(--burgundy-deep)" },
            ].map((node, i, arr) => (
              <div key={node.name} className="contents">
                <div className="flex flex-col items-center justify-center p-4 bg-[var(--paper-soft)] border rounded-sm" style={{ borderColor: node.color }}>
                  <div className="font-serif-cn font-semibold text-sm" style={{ color: node.color }}>
                    {node.name}
                  </div>
                  <div className="font-serif-en italic text-[10px] text-[var(--ink-muted)] mt-1">
                    {node.tech}
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div className="hidden md:flex items-center justify-center text-[var(--ink-muted)]">
                    →
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 pt-6 border-t border-dotted border-[var(--rule)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <p className="font-serif-en italic text-sm text-[var(--ink-muted)]">
              “From a flat PDF to a conversational knowledge artifact — in one pass.”
            </p>
            <p className="font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)]">
              Deployable via Docker Compose · 2 vCPU / 2 GiB sufficient
            </p>
          </div>
        </div>

        {/* v2.0 工程决策卡片 */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="scholarly-card p-6 fade-up" style={{ animationDelay: "120ms" }}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[var(--rule)]">
              <h3 className="journal-heading text-lg">解耦式架构</h3>
              <span className="font-serif-en italic text-xs text-[var(--ink-muted)]">Decoupled</span>
            </div>
            <p className="font-serif-cn text-sm text-[var(--ink-soft)] leading-[1.85]">
              Landing 公开门面页与 App 工作区物理分离 —— 前者不需要登录、面向
              GitHub 引流与社交分享，后者受 Next.js middleware 全量保护。两个
              区域可以独立部署、独立扩容、独立迭代。
            </p>
            <div className="mt-4 pt-3 border-t border-dotted border-[var(--rule)] font-serif-en italic text-xs text-[var(--ink-muted)]">
              v2.0 · / + /app · independent routing
            </div>
          </div>

          <div className="scholarly-card p-6 fade-up" style={{ animationDelay: "240ms" }}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[var(--rule)]">
              <h3 className="journal-heading text-lg">Docker 多阶段构建</h3>
              <span className="font-serif-en italic text-xs text-[var(--ink-muted)]">Multi-stage</span>
            </div>
            <p className="font-serif-cn text-sm text-[var(--ink-soft)] leading-[1.85]">
              三阶段（deps → builder → runner）构建，runner 仅含 standalone
              产物 + Prisma 客户端 + tini PID 1。镜像体积从全量 node_modules
              的 1.2 GB 压缩到约 180 MB，冷启动 &lt; 5 秒。
            </p>
            <div className="mt-4 pt-3 border-t border-dotted border-[var(--rule)] font-serif-en italic text-xs text-[var(--ink-muted)]">
              node:20-alpine · tini · standalone server.js
            </div>
          </div>

          <div className="scholarly-card p-6 fade-up" style={{ animationDelay: "360ms" }}>
            <div className="flex items-baseline justify-between mb-4 pb-3 border-b border-[var(--rule)]">
              <h3 className="journal-heading text-lg">Prisma v6 锁版</h3>
              <span className="font-serif-en italic text-xs text-[var(--ink-muted)]">Pinned</span>
            </div>
            <p className="font-serif-cn text-sm text-[var(--ink-soft)] leading-[1.85]">
              显式锁 <code className="font-mono text-[var(--burgundy)]">@prisma/client@6.11.1</code>。
              v7 引入 breaking change —— schema 中 <code className="font-mono">url</code> 字段
              不再支持，会直接破坏现有 SQLite 数据源配置。锁版是务实的工程妥协。
            </p>
            <div className="mt-4 pt-3 border-t border-dotted border-[var(--rule)] font-serif-en italic text-xs text-[var(--ink-muted)]">
              6.11.1 · until v7 schema migration is ready
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
