"use client";

import { CheckCircle2, Circle, Sparkles, Rocket } from "lucide-react";

/**
 * Roadmap Section — v2.0 新增章节
 *
 * 四个阶段的时间线：
 *   v1.0  已交付 · MVP 单机可用
 *   v2.0  已交付 · 解耦式架构 + Docker + ECS 部署
 *   v2.1  近期   · 域名+HTTPS+Landing 独立+模型路由
 *   v2.2  中期   · 协作标注+K8s+移动端
 *   v3.0+ 长期   · 知识图谱+科研助手+文献综述
 *
 * 设计语言：左侧版本徽章 + 时间轴圆点 + 右侧条目卡片。
 * 已交付用 burgundy 实心，规划中用空心 + 虚线连接。
 */
type Stage = {
  version: string;
  period: string;
  title: string;
  status: "done" | "next" | "planned" | "future";
  items: { name: string; detail: string; done?: boolean }[];
};

const STAGES: Stage[] = [
  {
    version: "v1.0",
    period: "2026.07 · 已交付",
    title: "MVP · 单机可用的 AI 文献阅读 Agent",
    status: "done",
    items: [
      { name: "五面板协同工作区", detail: "PDF 原文 / 智能解析 / 思维导图 / Agent 提问 / 全文框架", done: true },
      { name: "六维度结构化分析", detail: "科学问题 · 论证思路 · 实验方法 · 论证逻辑 · 创新性 · 局限性", done: true },
      { name: "MinerU + DeepSeek 接入", detail: "PDF → Markdown → 结构化 JSON → 对话上下文", done: true },
      { name: "NextAuth + SQLite + Prisma", detail: "邮箱密码登录 / 个人文献库 / 用量配额", done: true },
    ],
  },
  {
    version: "v2.0",
    period: "2026.07 · 已交付",
    title: "解耦式架构 · 生产部署就绪",
    status: "done",
    items: [
      { name: "Landing / App 解耦", detail: "公开门面页与受保护工作区物理分离，独立部署", done: true },
      { name: "Docker 三阶段构建", detail: "deps → builder → runner，镜像 180 MB，冷启动 <5s", done: true },
      { name: "阿里云 ECS 一键部署", detail: "deploy.sh + docker-compose.yml + .env.production 模板", done: true },
      { name: "生产环境加固", detail: "登录墙 / 50MB 上传 / Prisma 日志静默 / standalone CMD 修正", done: true },
    ],
  },
  {
    version: "v2.1",
    period: "近期 · 1-2 周",
    title: "独立域名 + 模型路由",
    status: "next",
    items: [
      { name: "域名 + Caddy + HTTPS", detail: "Let's Encrypt 自动签发，Caddy 反代 127.0.0.1:3000" },
      { name: "Landing 独立子域名", detail: "medreader.x → 宣传页，app.medreader.x → 工作区" },
      { name: "多模型路由", detail: "DeepSeek / Claude / GPT 可切换，按任务类型自动选择" },
      { name: "分享链接增强", detail: "og:image 预览 + 微信卡片 + 二维码生成" },
    ],
  },
  {
    version: "v2.2",
    period: "中期 · 1-2 月",
    title: "协作 + K8s + 移动端",
    status: "planned",
    items: [
      { name: "协作标注", detail: "团队共享文献库 + 多人高亮 + 评论线程" },
      { name: "Kubernetes 部署", detail: "Helm Chart + HPA 自动扩容 + 多副本读" },
      { name: "PWA 移动端适配", detail: "iPad / 平板阅读优化 + 离线缓存 + 触控手势" },
      { name: "Webhook 集成", detail: "新增论文自动推送 Slack / 飞书 / 企业微信" },
    ],
  },
  {
    version: "v3.0+",
    period: "长期 · 季度规划",
    title: "从阅读器到科研助手",
    status: "future",
    items: [
      { name: "个人知识图谱", detail: "跨论文实体抽取 + Neo4j 可视化 + 关系推理" },
      { name: "科研助手 Agent", detail: "主动推荐相关文献 / 提示研究空白 / 生成 follow-up" },
      { name: "文献综述生成", detail: "多论文对比矩阵 + 综述章节草稿 + 引用网络" },
      { name: "本地 RAG 增强", detail: "个人文献库向量化 + 本地推理 + 隐私保护" },
    ],
  },
];

const STATUS_STYLE: Record<
  Stage["status"],
  { badge: string; dot: string; line: string; icon: typeof CheckCircle2 }
> = {
  done: {
    badge: "bg-[var(--burgundy)] text-[var(--paper)] border-transparent",
    dot: "bg-[var(--burgundy)] border-[var(--burgundy)]",
    line: "border-[var(--burgundy)]",
    icon: CheckCircle2,
  },
  next: {
    badge: "bg-[var(--gold)] text-[var(--burgundy-deep)] border-transparent",
    dot: "bg-[var(--gold)] border-[var(--gold)] ring-4 ring-[var(--gold)]/20",
    line: "border-dashed border-[var(--gold)]",
    icon: Sparkles,
  },
  planned: {
    badge: "bg-transparent text-[var(--ink-soft)] border-[var(--rule)]",
    dot: "bg-[var(--paper)] border-[var(--ink-muted)]",
    line: "border-dashed border-[var(--rule)]",
    icon: Circle,
  },
  future: {
    badge: "bg-transparent text-[var(--ink-muted)] border-[var(--rule)]",
    dot: "bg-[var(--paper)] border-[var(--rule)]",
    line: "border-dotted border-[var(--rule)]",
    icon: Rocket,
  },
};

export function Roadmap() {
  return (
    <section
      id="roadmap"
      className="py-20 lg:py-28 border-t border-[var(--rule)]"
      style={{ background: "var(--paper-soft)" }}
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ VII.</div>
            <div className="journal-heading-en text-sm">
              Roadmap / 项目路线图
            </div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              从一个 AI 阅读器，长成一个科研助手
            </h2>
            <p className="font-serif-cn text-[var(--ink-soft)] text-lg leading-relaxed max-w-3xl">
              v1.0 与 v2.0 已交付，是一个可单机可生产部署的 AI 文献阅读 Agent。
              接下来三个版本将依次解决域名独立、协作、知识图谱与综述生成，
              最终让 MedReader 成为研究者的长期科研伙伴。
            </p>
          </div>
        </div>

        {/* 时间线 */}
        <div className="relative">
          {STAGES.map((s, idx) => {
            const style = STATUS_STYLE[s.status];
            const Icon = style.icon;
            const isLast = idx === STAGES.length - 1;
            return (
              <div key={s.version} className="relative grid grid-cols-12 gap-6 pb-12">
                {/* 左侧版本徽章 + 时间轴 */}
                <div className="col-span-12 md:col-span-3 relative">
                  <div className="flex md:flex-col items-start gap-4">
                    <div className="flex items-center gap-3 md:flex-row">
                      {/* 时间轴圆点 */}
                      <div
                        className={`relative w-4 h-4 rounded-full border-2 shrink-0 ${style.dot}`}
                      >
                        {!isLast && (
                          <div
                            className={`absolute left-1/2 top-full w-px h-[calc(100%+3rem)] md:h-[calc(100%+4.5rem)] -translate-x-1/2 border-l-2 ${style.line}`}
                          />
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 font-sans-ui text-xs tracking-[0.1em] uppercase rounded-sm border ${style.badge}`}
                      >
                        <Icon className="w-3 h-3" />
                        {s.version}
                      </span>
                    </div>
                    <div className="font-serif-en italic text-xs text-[var(--ink-muted)] md:mt-2 md:pl-7">
                      {s.period}
                    </div>
                  </div>
                </div>

                {/* 右侧条目卡片 */}
                <div className="col-span-12 md:col-span-9">
                  <div className="scholarly-card p-6 lg:p-8">
                    <h3 className="journal-heading text-xl lg:text-2xl mb-5 pb-3 border-b border-[var(--rule)]">
                      {s.title}
                    </h3>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
                      {s.items.map((it) => (
                        <div key={it.name} className="flex items-start gap-3">
                          {it.done ? (
                            <CheckCircle2 className="w-4 h-4 text-[var(--burgundy)] mt-1 shrink-0" />
                          ) : (
                            <Circle className="w-4 h-4 text-[var(--ink-muted)] mt-1 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div
                              className={`font-serif-cn font-semibold text-sm ${
                                it.done
                                  ? "text-[var(--ink)]"
                                  : "text-[var(--ink-soft)]"
                              }`}
                            >
                              {it.name}
                            </div>
                            <div className="font-serif-en italic text-xs text-[var(--ink-muted)] mt-0.5 leading-relaxed">
                              {it.detail}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部说明 */}
        <div className="mt-8 pt-6 border-t border-dotted border-[var(--rule)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <p className="font-serif-en italic text-sm text-[var(--ink-muted)]">
            “Roadmaps are hypotheses, not promises.” — adjusted every sprint.
          </p>
          <a
            href="https://github.com/Cymene1205/Medreader/milestones"
            target="_blank"
            rel="noopener noreferrer"
            className="font-sans-ui text-[10px] tracking-[0.18em] uppercase text-[var(--burgundy)] hover:underline"
          >
            Track milestones on GitHub ↗
          </a>
        </div>
      </div>
    </section>
  );
}
