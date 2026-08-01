"use client";

import { Server, Globe, ShieldCheck, ArrowRight } from "lucide-react";

/**
 * Deployment Section — v2.0 新增章节
 *
 * 展示两块内容：
 *   1. 阿里云 ECS 云主机部署概述（不暴露具体规格）
 *   2. URL 策略三阶段（IP+端口 → 域名+Caddy+HTTPS → 子域名分别绑定）
 *
 * 配色与 burgundy 期刊风一致：scholarly-card + burgundy 强调色。
 */
const ECS_HIGHLIGHTS = [
  { label: "云服务商", en: "Provider", value: "阿里云 ECS", note: "Aliyun Elastic Compute Service" },
  { label: "部署形态", en: "Topology", value: "单机容器化", note: "Docker Compose 一键拉起" },
  { label: "反向代理", en: "Reverse Proxy", value: "Caddy 2.x", note: "自动 HTTPS · Let's Encrypt" },
  { label: "进程编排", en: "Orchestration", value: "tini + Next.js standalone", note: "PID 1 信号转发" },
  { label: "数据持久化", en: "Persistence", value: "Volume 挂载", note: "SQLite + 上传文件" },
  { label: "健康检查", en: "Health Check", value: "GET / · 30s 间隔", note: "3 次失败自动重启" },
];

const URL_STAGES = [
  {
    stage: "v2.0",
    period: "当前 · 已交付",
    pattern: "http://<your-ecs-ip>:3000",
    desc: "IP + 端口直连 Docker 容器，无域名无 HTTPS。适合内部测试与冒烟验收。",
    status: "active",
  },
  {
    stage: "v2.1",
    period: "近期 · 1-2 周",
    pattern: "https://medreader.example.com",
    desc: "域名 + Caddy 反向代理 + Let's Encrypt 自动签发 HTTPS 证书。Caddy 监听 80/443，反代到 127.0.0.1:3000。",
    status: "planned",
  },
  {
    stage: "v2.2",
    period: "中期 · 1-2 月",
    pattern: "https://app.medreader.example.com  ·  https://medreader.example.com",
    desc: "子域名分别绑定 —— 根域展示 landing 宣传页，app 子域承载工作区。物理隔离两套部署，可独立扩容。",
    status: "planned",
  },
];

export function DeploymentSection() {
  return (
    <section
      id="deployment"
      className="paper-bg py-20 lg:py-28 border-t border-[var(--rule)]"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ VI.</div>
            <div className="journal-heading-en text-sm">
              Deployment / 部署方案
            </div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              一台云主机，跑得起一个 AI 文献阅读 Agent
            </h2>
            <p className="font-serif-cn text-[var(--ink-soft)] text-lg leading-relaxed max-w-3xl">
              全栈容器化部署到阿里云 ECS。Docker Compose 一键拉起，Prisma
              db push 自动迁移，standalone server.js 直出端口 3000。
              没有 Kubernetes，没有 Service Mesh，没有过度工程。
            </p>
          </div>
        </div>

        {/* 阿里云 ECS 部署概览 */}
        <div className="scholarly-card p-8 lg:p-10 mb-10">
          <div className="flex items-center gap-3 mb-8">
            <Server className="w-5 h-5 text-[var(--burgundy)]" />
            <h3 className="journal-heading text-xl">阿里云 ECS 部署概览</h3>
            <span className="font-serif-en italic text-xs text-[var(--ink-muted)] ml-auto">
              Powered by Aliyun · Open Source
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
            {ECS_HIGHLIGHTS.map((s) => (
              <div
                key={s.label}
                className="pb-4 border-b border-dotted border-[var(--rule)]"
              >
                <div className="font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)] mb-1">
                  {s.label} · <span className="font-serif-en italic normal-case">{s.en}</span>
                </div>
                <div className="font-serif-cn font-semibold text-base text-[var(--ink)]">
                  {s.value}
                </div>
                <div className="font-serif-en italic text-xs text-[var(--ink-muted)] mt-1">
                  {s.note}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 pt-6 border-t border-dotted border-[var(--rule)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <p className="font-serif-en italic text-sm text-[var(--ink-muted)]">
              “A single VPS, a single container, a single command: <code className="font-mono text-[var(--burgundy)]">bash deploy.sh</code>.”
            </p>
            <p className="font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)]">
              Docker Compose · tini PID 1 · healthcheck on /
            </p>
          </div>
        </div>

        {/* URL 策略三阶段 */}
        <div className="scholarly-card p-8 lg:p-10">
          <div className="flex items-center gap-3 mb-8">
            <Globe className="w-5 h-5 text-[var(--burgundy)]" />
            <h3 className="journal-heading text-xl">URL 策略三阶段</h3>
            <span className="font-serif-en italic text-xs text-[var(--ink-muted)] ml-auto">
              IP → Domain → Subdomain
            </span>
          </div>

          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full border-collapse min-w-[680px]">
              <thead>
                <tr className="border-b-2 border-[var(--ink)]">
                  <th className="text-left py-3 pr-4 font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)]">
                    版本
                  </th>
                  <th className="text-left py-3 pr-4 font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)]">
                    时间
                  </th>
                  <th className="text-left py-3 pr-4 font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)]">
                    访问形式
                  </th>
                  <th className="text-left py-3 font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--ink-muted)]">
                    说明
                  </th>
                </tr>
              </thead>
              <tbody>
                {URL_STAGES.map((s) => (
                  <tr
                    key={s.stage}
                    className="border-b border-[var(--rule)] align-top"
                  >
                    <td className="py-4 pr-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-sans-ui text-[11px] tracking-[0.1em] uppercase rounded-sm ${
                          s.status === "active"
                            ? "bg-[var(--burgundy)] text-[var(--paper)]"
                            : "bg-[var(--paper-dark)] text-[var(--ink-soft)] border border-[var(--rule)]"
                        }`}
                      >
                        {s.status === "active" && <ShieldCheck className="w-3 h-3" />}
                        {s.stage}
                      </span>
                    </td>
                    <td className="py-4 pr-4 font-serif-cn text-sm text-[var(--ink-soft)] whitespace-nowrap">
                      {s.period}
                    </td>
                    <td className="py-4 pr-4">
                      <code className="font-mono text-xs text-[var(--burgundy)] bg-[var(--paper-dark)] px-2 py-1 rounded-sm whitespace-nowrap">
                        {s.pattern}
                      </code>
                    </td>
                    <td className="py-4 font-serif-cn text-sm text-[var(--ink-soft)] leading-relaxed">
                      {s.desc}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 pt-6 border-t border-dotted border-[var(--rule)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <p className="font-serif-en italic text-sm text-[var(--ink-muted)] flex items-center gap-2">
              <ArrowRight className="w-3.5 h-3.5" />
              Caddyfile 三行配置反代 + 自动 HTTPS · 详见仓库 README
            </p>
            <a
              href="https://github.com/Cymene1205/Medreader"
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--burgundy)] hover:underline"
            >
              View deploy.sh on GitHub ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
