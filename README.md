# MedReader Agent

> **以 figure 为核心主线的开源生命科学文献 AI 阅读器** — 把"读图 / 翻译 / 问答 / 原文定位"四件事收进一个界面。
>
> *Turning dense medical PDFs into a navigable, conversational, and critique-ready knowledge base.*

[![License: MIT](https://img.shields.io/badge/License-MIT-burgundy.svg)](LICENSE)
[![Made with Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![Status: Healthy](https://img.shields.io/badge/Status-Healthy-success.svg)](#deployment)

**仓库**：[github.com/Cymene1205/Medreader](https://github.com/Cymene1205/Medreader) · **版本**：v0.3.0 · **协议**：MIT

---

## § I. 这是什么 — 项目概览

MedReader Agent 是一个面向生命科学研究者的开源 AI 阅读器，专门解决"读主刊 figure 密集型论文"这一具体场景。它把 PDF 解析、figure 提取、引文对齐、4 层结构化分析、多模型对话、视觉模型看图、Markdown / 思维导图下载整合成**一条完整流水线**，让一个网页同时承担原本需要 5–7 个工具才能完成的工作。

### 五个差异化卖点

1. **Figure-first 设计哲学** — 把 figure 当作论证主轴而不是附属品，每个 figure 都有独立的卡片、深度解析、与正文的引文对齐
2. **全链路合一，不再切窗口** — 终结"知云 + GPT + 5 个浏览器标签 + 截图工具"的割裂体验，所有阅读动作都在一个界面完成
3. **多 LLM + 自选模型接入** — 预置 DeepSeek / OpenAI / 智谱 / Moonshot / Anthropic 五家，外加 `CUSTOM_LLM` 三个 env 接任意 OpenAI 兼容端点（vLLM / Ollama / LM Studio / Together AI 等）
4. **实时 Token 监控面板** — 管理员后台按 provider / model / action 三维度聚合 token 消耗与估算成本（人民币），调用次数、用户配额、反馈统计一目了然
5. **Markdown + 思维导图双格式下载** — 4 层分析可一键导出为标准 Markdown 文档（可导入 Obsidian / Notion）或独立 HTML 思维导图（浏览器直接打开，无需服务端）

### 适用人群

- 生命科学 / 医学方向的博士生、博士后、PI
- 需要频繁阅读 Cell / Nature / Science 主刊 figure 密集型论文的研究者
- 受够了在多个工具间切换、希望"一篇论文 10 分钟读完且能复述核心 figure"的人
- 想要自托管、保护数据隐私、又不想放弃 LLM 能力的团队

### 当前状态

v0.3.0 已经在阿里云 ECS（2 vCPU / 2 GiB / 40 GiB）上稳定运行，支持 Docker Compose 一键部署。生产环境实测：MinerU POST 提交 580ms 返回、10MB PDF 上传 + 解析全流程约 2–4 分钟、DeepSeek 4 层分析 30–60 秒。

---

## § II. figure-first 设计哲学 — 终结"工具栈割裂"

### 传统科研阅读的噩梦

读一篇主刊 figure 密集型文章（比如 Cell 的 7-panel 主图、Nature 的多模态机制图），你过去的实际工作流大概是这样：

- **A 窗口**：知云文献翻译或 Adobe Reader 看 PDF 原文
- **B 浮窗**：知云划词翻译，遇到专业术语随时查
- **C 浏览器 1**：Google Scholar 查这篇论文的引用与被引
- **D 浏览器 2**：PubMed 检索作者的其他相关工作
- **E 浏览器 3**：ChatGPT / Claude 网页版，问"Figure 2C 这个流式图说明了什么"
- **F 截图工具**：QQ 截图 / macOS Snipping 把 figure 切下来贴给 LLM
- **G 笔记软件**：Notion / Obsidian / Word 整理要点

**真实发生的问题**：

- LLM 给出答案后找不到原文出处，"它说的那个段落到底在第几页？"
- Figure 截图脱离了 caption，AI 看图但不知道这是 Figure 2A 还是 2B
- 切换窗口时思路丢失，"我刚才想问什么来着？"
- 引文和 figure 对不上，"这个结论是 Figure 几支持的？"
- 浏览器开太多标签崩溃重来，之前查的全没了
- 截图分辨率不够，AI 看不清 figure 里的细节标注

这不是效率问题，是**认知流断裂**。每多一次窗口切换，你就丢失一次上下文。读完一篇 30 页主刊，你可能切了 200 次窗口，记下的东西却少得可怜。

### MedReader 的回答

一个界面，一条主线 —— **figure 就是阅读流本身，不是离开阅读流的附属品**。

1. **PDF 原文 + 自动提取的 figure + caption 同屏对齐**：上传 PDF 后，MinerU 把每个 figure 单独切出来，配上完整 caption，左侧是 PDF，右侧是 figure 卡片列表
2. **4 层分析锚定 figure 编号**：分析结果不是抽象总结，而是直接引用"Figure 2A 显示…Figure 5 揭示…Figure 6B 验证…"，点击编号就能跳回对应 figure
3. **多 LLM 对话上下文自带原文 + figure + 引文**：你问任何问题，AI 看到的上下文里就有完整正文 + 当前 figure + 它的 caption + 引用它的句子，答完能溯源到原文段落
4. **VLM 直接看 figure 原图逐 panel 解释**：不懂 Figure 4G 那个 UMAP？点"深度解析"，视觉模型直接读图，按 panel A/B/C/D 顺序拆解每个子图含义
5. **引文追溯闭环**：figure → 找到正文哪句话引用它 → 跳到对应段落 → 段落上下文联动高亮 → 再回到 figure 看更细的 panel

### 为什么是 figure-first 而不是 text-first

生命科学论文的特殊性在于：**figure 不是装饰，是论证主轴**。

- Figure 1 通常是实验设计概览（动物模型、样本来源、时间线）
- Figure 2–5 是核心实验结果（流式、WB、IF、scRNA-seq）
- Figure 6+ 是机制模型（通路图、信号网络）
- 补充材料里还有大量 Extended Data Figures

读这种文章，文字反而是 figure 的注脚。如果你不能在阅读过程中高效地看 figure、对齐 caption、理解 panel 之间的逻辑关系，你就**没有读懂这篇论文**。传统 PDF 阅读器把 figure 当附属品（要么嵌在文字流里要么根本不提取），导致"读图"必须离开阅读流——这是 MedReader 要解决的根本问题。

MinerU 提供的 block 级解析（含 `page_idx` / `bbox` / `chart_caption` 字段）让"figure 与正文 caption 完整对齐"在工程上第一次成为可能。MedReader 把这个能力用到了极致。

---

## § III. 核心功能全景

### 1. PDF 上传与 MinerU block 级解析

上传 PDF 后，调用 MinerU Cloud 的 v4 batch upload API 完成解析。返回的不是平铺文本，而是带 `page_idx`、`bbox`、`text_level` 的 block 数组——每个 block 知道自己在第几页、坐标范围、是标题还是段落还是图片。这些 block 后续驱动了 figure 提取、引文对齐、思维导图布局、段落导航高亮等所有下游能力。

PDF 大小限制 50MB（与 `experimental.proxyClientMaxBodySize` 一致），MinerU vlm 模式对 30+ 页大 PDF 解析约 4–6 分钟，有 10 分钟硬上限后回退到 pdfjs-dist 离线解析作为兜底。

### 2. Figure 提取与 caption 对齐

`src/lib/extract-figures.ts` 从 MinerU 的 content_list 中筛出所有 `type === "image"` 的 block，配合 `chart_caption` 字段构建 Figure 记录。这里有一个关键细节：**MinerU vlm 模式输出的 `chart_caption` 是数组而不是字符串**，典型结构是 `["A", "B", "Single-cell RNA-seq reveals...", "Figure 2. ..."]`——前几项是 panel label（A/B/C），最后一项才是真正的 figure caption。

提取逻辑要正确识别 panel label vs figure caption，把 panel count 写入 `Figure.panelCount`，把完整 caption 写入 `Figure.caption`。补充材料图（Fig. S / Extended Data）在提取阶段就被过滤掉，不进入主表。

### 3. 4 层统一分析框架

`src/lib/analyze-stage2.ts` 调用 LLM 生成结构化分析，替代了旧的 6 维度 outline。四层分别是：

- **questionBackground**（问题与背景）：这篇论文要回答什么科学问题？为什么这个问题重要？
- **argumentSpine**（论证主线）：作者怎么一步步证明结论的？关键实验和 figure 是哪些？
- **novelty**（创新性）：相比已有工作，新在哪？方法创新还是发现创新？
- **limitsOpportunities**（局限与机会）：作者回避了什么？后续可以怎么延伸？

每一层都锚定具体的 figure 编号和原文段落，不是泛泛而谈。结果存入 `Paper.analysisJson`，前端用 `OutlinePanel` 和 `MindmapView` 两个组件分别以目录树和思维导图形式展示。

### 4. 引文追溯（citationsJson）

`src/lib/align-citations.ts` 扫描正文所有句子，找出包含 "Figure N" / "Fig. N" / "图 N" 的句子，建立 `{ figureLabel, panels[], sentence, pageIndex, isSupp }` 的映射表。前端点击 figure 卡片时，能立即显示"这句话在正文哪里被引用、引用了哪些 panel"，反向点击正文段落也能高亮对应的 figure。

### 5. 多模型对话

`src/app/api/chat/route.ts` + `src/lib/llm.ts` 实现了一个抽象的 LLM 层。前端用户可以通过 LLM Settings Dialog（齿轮图标）随时切换 provider，无需重新登录。系统默认 DeepSeek（国内访问稳定、长文本便宜），用户可以切到 GPT-4o 处理复杂推理、Claude 处理写作、Moonshot 处理超长上下文。

每次对话的上下文里都自带：当前论文的 markdown 全文 + 当前选中的 figure + figure caption + 引文句子。这意味着你问"Figure 3B 那个柱状图为什么对照组在 24h 就下降了"，AI 不需要你重新解释上下文。

### 6. Figure 深度解析（Call A + Call B）

每个 figure 都有两次 LLM 调用：

- **Call A**（批量，论文级）：`/api/figures` 一次调用处理论文的所有 figure，输出 5 个字段——`question`（这图回答什么问题）、`method`（用了什么技术）、`role`（铺垫/关键证据/验证/延伸）、`isLinchpin`（是否核心图，每篇 ≤2 个）、`chainIndex`（在叙事链中的顺序）。这五个字段驱动 Figure Chain 视图，让你一眼看出哪几张图是核心
- **Call B**（按需，figure 级）：`/api/figure-detail` 用户展开某张 figure 卡片时触发，VLM 直接读图，按 panel A/B/C/D 逐个解释，输出 `{ question, closure, layers[], bridge }` 结构

### 7. 下载与导出

`src/lib/export-utils.ts` 提供两个独立的下载接口：

- **Markdown 智能分析版**：包含 4 层分析 + 所有 figure caption 的结构化 .md 文件，可直接导入 Obsidian / Notion / Logseq 作为个人知识库条目
- **HTML 思维导图**：独立 .html 文件，浏览器直接打开就渲染成 poster 风格的思维导图，无需服务端，适合会议演示或离线分享

两个格式都在客户端生成（无 API 调用），下载即时、可离线使用。

---

## § IV. 典型使用场景

### 场景 1：组会前 10 分钟读懂主刊文章

每周组会要精读一篇 30 页的 Cell 文章。过去需要花 1 小时来回切窗口——读 PDF、查术语、问 ChatGPT、整理笔记。现在上传 PDF，等 3 分钟解析完成，4 层分析 + figure 全解立刻可用，10 分钟就能复述"这篇论文的科学问题是什么、核心 figure 是 2A 和 5C、创新点在哪、作者回避了什么"。节省时间约 50 分钟/篇。

### 场景 2：写综述时跨多篇论文做 figure 横向对比

写综述要对比 10 篇文章的同主题 figure（比如不同团队对同一通路的 scRNA-seq 分析）。MedReader 把每篇论文的 figure 都结构化存储，Call A 输出的 `question` / `method` / `role` 字段可以直接做横向对比表——哪些用了 10X、哪些用了 Smart-seq2、哪些 figure 是关键证据。导出 Markdown 后在 Notion 里汇总成对比表。

### 场景 3：基金申请书撰写时引用 figure 数据

写基金本子要引用某篇文献的 Figure 3B 数据，过去要打开 PDF 找到 figure 截图贴到本子里，还要查 caption 准确转录。现在点开 figure 卡片就能下载原图 + 复制 caption，引文追溯直接定位到正文原句，引用不会断章取义。

### 场景 4：实验设计参考看别人怎么设计 panel

设计自己的实验时想看"别人怎么做 4 时间点 × 3 处理组的流式 panel"。在 MedReader 里搜相关论文，Figure Chain 视图按 `chainIndex` 排序展示叙事链，看 Figure 1 的实验设计图怎么布局 panel A/B/C/D，作为自己实验设计的参考。

### 场景 5：VLM 看 figure 搞不懂时逐 panel 解释

遇到一张 8 个 panel 的复杂 figure（IF + WB + 流式 + 通路图混合），自己看 20 分钟也理不清逻辑。点"深度解析"触发 Call B，VLM 直接读图，按 panel A→B→C→D 顺序解释每个子图展示了什么数据、说明了什么结论、与上一个 panel 的逻辑关系。1 分钟看完，比反复放大缩小 PDF 高效得多。

### 场景 6：外出/会后思维导图下载在手机上复习

会议现场没带电脑，但晚上要汇报一篇论文。提前在 MedReader 解析好，下载 HTML 思维导图到手机，开会前用手机浏览器打开，4 层框架 + figure caption 一目了然，全程离线可用。

---

## § V. 技术架构总览

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                            浏览器 / 用户                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ PDF Viewer   │ │ Block Reader │ │ Mindmap View │ │ Chat Panel │ │
│  │ (pdfjs-dist) │ │ (MinerU MD)  │ │ (Dagre)      │ │ (多 LLM)   │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                  │
│  │ Figure Chain │ │ Outline Nav  │ │ Translation  │                  │
│  └──────────────┘ └──────────────┘ └──────────────┘                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS (NextAuth session cookie)
┌──────────────────────────────┴──────────────────────────────────────┐
│              Next.js 16 (Turbopack) · App Router · RSC              │
│                                                                      │
│  ┌─────────── API Routes (Node.js runtime, maxDuration=300) ──────┐ │
│  │ /api/upload         /api/analyze       /api/chat                │ │
│  │ /api/figures        /api/figure-detail /api/translate           │ │
│  │ /api/vision         /api/followups     /api/quota               │ │
│  │ /api/paper-images   /api/figure-image/[id]                       │ │
│  │ /api/admin/stats    /api/llm-test      /api/feedback            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────── Business Logic (src/lib/) ──────────────────┐ │
│  │ mineru.ts          — MinerU API client (AbortController+retry) │ │
│  │ extract-figures.ts — Figure 提取与 caption 对齐                 │ │
│  │ align-citations.ts — 引文追溯映射                              │ │
│  │ analyze-stage2.ts  — 4 层分析 prompt + LLM 调用                │ │
│  │ llm.ts             — LLM provider 抽象 + cost 估算             │ │
│  │ quota.ts           — 每日配额计数                              │ │
│  │ export-utils.ts    — Markdown + HTML 思维导图导出              │ │
│  │ auth.ts            — NextAuth 配置                             │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────┬───────────────────────────────┬───────────────────────────┘
          │                               │
          ▼                               ▼
┌─────────────────────┐         ┌────────────────────────┐
│  Prisma + SQLite    │         │   外部 API             │
│  ./data/custom.db   │         │ ┌────────────────────┐ │
│                     │         │ │ MinerU Cloud       │ │
│  • User / Account   │         │ │ (PDF 解析)         │ │
│  • Paper / Figure   │         │ ├────────────────────┤ │
│  • ChatLog          │         │ │ DeepSeek / OpenAI  │ │
│  • TokenUsage       │         │ │ / 智谱 / Moonshot  │ │
│  • DailyQuota       │         │ │ / Anthropic / 自定 │ │
│  • UsageEvent       │         │ ├────────────────────┤ │
│  • Feedback         │         │ │ VLM (glm-4v-flash) │ │
└─────────────────────┘         │ │ (Figure 看图)      │ │
                                └────────────────────┘ │
                                └────────────────────────┘

部署层: Docker Compose (medreader + 可选 searxng)
        node:20-alpine + tini + bun + Caddy 反代
        持久化卷: ./data (SQLite) + ./uploads (PDF + 提取的 figure 图片)
```

### 单体分层的设计取舍

为什么不上微服务？因为目标用户是个人研究者或小团队，单机部署（2 vCPU / 2 GiB ECS）就能跑起来。微服务带来的复杂度（服务发现、网关、链路追踪、跨服务事务）远超收益。Next.js 的 API Routes + Prisma + SQLite 这个组合，一台 2G 内存的服务器可以稳定支撑 5–10 个并发用户，每个用户每月读 50+ 篇论文毫无压力。

如果未来要扩展到团队/机构级别，迁移路径也很清晰：SQLite → PostgreSQL（Prisma 改一行 connection string）、单容器 → 多容器 + Nginx 负载均衡、本地 uploads → OSS / S3。架构层面不需要重写。

### 关键技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 前端框架 | Next.js 16 + Turbopack | RSC 减少 client bundle、App Router 嵌套布局适合多面板 |
| 类型系统 | TypeScript 5（strict） | 医学领域不允许类型模糊 |
| 样式 | Tailwind CSS 4 + shadcn/ui (New York) | 设计系统统一、组件可复制粘贴 |
| 状态管理 | Zustand（client）+ TanStack Query（server） | 比 Redux 轻、比 Context 高效 |
| ORM | Prisma 6 + SQLite | 类型安全、迁移简单、单机零运维 |
| 认证 | NextAuth.js v4 | 邮箱密码 + Session，未来加 OAuth 不用改架构 |
| PDF 解析 | MinerU Cloud + pdfjs-dist 兜底 | MinerU 提供 block 级结构，pdfjs 保证可用性 |
| 思维导图 | Dagre + @xyflow/react | 自动布局 + 可交互节点 |
| 多 LLM | 自研抽象层（OpenAI 兼容协议） | 6 个 provider 一套接口，用户可秒切 |
| 部署 | Docker Compose + Caddy | 一键起、自动 HTTPS、资源占用低 |

---

## § VI. 数据模型与处理流水线

### Prisma Schema 概览

完整 schema 见 `prisma/schema.prisma`，核心模型 9 张表：

```
User         ─── 用户账号 (email/passwordHash/role)
Account      ─── OAuth 账号关联 (NextAuth 标准)
Session      ─── 登录会话
Paper        ─── 论文记录 (核心表，含 markdown/blocksJson/analysisJson)
Figure       ─── 提取的 figure (含 Call A/B 输出)
ChatLog      ─── 对话历史
Feedback     ─── 答案反馈 (up/down + reason)
UsageEvent   ─── 用户行为事件流
DailyQuota   ─── 每日配额计数 (按 user+action+day 聚合)
TokenUsage   ─── LLM 调用 token 消耗 + 成本估算 (admin 面板数据源)
```

关键字段说明：

- **Paper.blocksJson**：MinerU content_list.json 的字符串化 JSON，包含每个 block 的 `page_idx` / `bbox` / `text_level`，是所有下游能力（figure 提取、引文对齐、思维导图）的源头
- **Paper.analysisJson**：4 层分析的字符串化 JSON，前端 OutlinePanel 和 MindmapView 共享这一份数据
- **Figure.isLinchpin**：Call A 输出，每篇论文 ≤2 个核心 figure，前端用特殊标记突出显示
- **Figure.detailJson**：Call B 输出，结构为 `{ question, closure, layers[], bridge }`，用户展开 figure 卡片时按需填充
- **TokenUsage.costCny**：按内置 COST_TABLE 估算的人民币成本，admin 面板按 provider / model / action 三维度聚合展示

### 完整数据流

```
1. 用户上传 PDF
   └─> /api/upload 收到 FormData
       ├─> 写入 ./uploads/<uuid>.pdf
       ├─> 创建 Paper 记录 (parseStatus="pending")
       └─> 异步触发 parseWithMinerU()

2. MinerU 解析 (src/lib/mineru.ts)
   ├─> Step 1: POST /api/v4/file-urls/batch → 拿到 presigned OSS URL + batch_id
   ├─> Step 2: PUT PDF 到 OSS (无 Content-Type，避免签名不匹配)
   ├─> Step 3: 轮询 /api/v4/extract-results/batch/{batch_id} (3.5s 间隔，10min 上限)
   └─> Step 4: 下载 full_zip_url，JSZip 解压，读 full.md + content_list.json

3. 写回 Paper
   ├─> Paper.markdown = full.md 内容
   ├─> Paper.blocksJson = JSON.stringify(content_list)
   ├─> Paper.imagesDir = uploads/<base>_images/
   ├─> Paper.pageCount = 推断的页数

4. Figure 提取 (extractAndStoreFigures)
   ├─> 从 blocks 筛 type==="image"
   ├─> 解析 chart_caption 数组 (识别 panel label)
   ├─> 过滤补充材料图 (Fig. S / Extended Data)
   └─> 批量创建 Figure 记录 (db.$transaction 保证原子性)

5. 引文对齐 (buildCitationsAndStore)
   ├─> 扫描正文所有句子
   ├─> 匹配 "Figure N" / "Fig. N" / "图 N" 模式
   └─> Paper.citationsJson = JSON.stringify(citations)

6. 更新 parseStatus="done"
   └─> ⚠️ 关键：必须在 extractAndStoreFigures + buildCitationsAndStore 之后才更新
       否则前端看到 done 但 figures 为空，永远不重试 (历史 bug 已修复)

7. 前端拉取
   ├─> 4 层分析 (如果 analysisJson 为空，触发 /api/analyze 异步生成)
   ├─> Figure Chain (Call A 批量分析)
   └─> 用户交互 (Call B 按需深度解析)
```

### parseStatus 竞态修复（历史 bug）

旧代码顺序是：解析成功 → 设 `parseStatus="done"` → 提取 figure。问题是前端轮询到 `done` 立刻拉 figure，但此时 Figure 表还是空的，前端永远不会重试（因为状态已经 done）。

新代码顺序：解析成功 → 提取 figure → 写 citationsJson → **最后**才设 `parseStatus="done"`。前端看到 done 时，figures 一定已经写完。

---

## § VII. 工程亮点 — 生产级可靠性

### 1. mineruFetch + AbortController 超时控制

`src/lib/mineru.ts` 包装了一个 `mineruFetch` 函数，每个 HTTP 调用都有独立的 `timeoutMs`：

| 调用场景 | timeoutMs | 理由 |
|---|---|---|
| POST submit | 30s | MinerU 通常 500ms 返回 |
| PUT upload | 30s × MB 数，封顶 5min | 文件越大传得越久 |
| Poll status | 30s | 单次轮询不应超 30s |
| Download zip | 180s | 大论文 zip 可能 50MB+ |

实现用 `AbortController` + `setTimeout`，不依赖 undici（Next.js 16 Turbopack 与 undici 8.x 不兼容）。每次调用都打印 timing 日志：`[mineru] POST mineru.net → 200 in 580ms`，便于线上排查慢请求。

### 2. fetchWithRetry 瞬态错误重试

`TRANSIENT_ERR_CODES` 集合包含 9 个可重试错误码：

```typescript
const TRANSIENT_ERR_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT",  // server 头部超时
  "UND_ERR_BODY_TIMEOUT",     // body 中断
  "UND_ERR_CONNECT_TIMEOUT",  // TCP 连不上
  "UND_ERR_SOCKET",           // socket 异常关闭
  "ABORT_TIMEOUT",            // 我们自己的 AbortController 触发
  "ECONNRESET",               // TCP RST
  "ECONNREFUSED",             // 服务未启动
  "ENOTFOUND",                // DNS 失败
  "EAI_AGAIN",                // DNS 临时失败
  "ETIMEDOUT",                // OS 级超时
]);
```

重试策略：3 次线性退避（1s / 2s / 3s）。HTTP 5xx 也重试，4xx 不重试（client error 不会自愈）。

### 3. DOMException.message getter-only 修复

这是一个真实的线上 bug。旧代码在 catch 块里写 `e.message = "Request aborted..."` 试图覆盖错误消息，但当 `e` 是 `DOMException`（AbortController.abort() 抛出的类型）时，`.message` 在原型链上是 **getter-only**，直接赋值会抛 `TypeError: Cannot set property message of which has only a getter`。

这个 TypeError 会 mask 掉原始的 abort 错误，向上冒泡变成"MinerU parse failed: TypeError"，但其实 MinerU API 本身完全正常（200 OK）。

修复方案：用局部变量 `logMsg` 替代直接赋值；当 normalized code 与原始 `e.code` 不一致时（DOMException.code 是数字 getter，不是字符串），wrap 成普通 `Error` 对象带 `.code` 作为 own property，保证 `fetchWithRetry` 的 `TRANSIENT_ERR_CODES.has(code)` 查找生效。

### 4. Path 遍历防御

`/api/paper-images` 和 `/api/figure-image/[figureId]` 两个路由服务用户上传的图片。早期代码用 `path.startsWith(ALLOWED_ROOT)` 做边界检查，但这种检查可被同级目录绕过（比如 `/app/uploads/../etc/passwd` 经过 normalize 后仍以 `/app/uploads/` 开头，但实际指向了系统文件）。

修复后用 `path.resolve` + `path.relative` 组合：

```typescript
const resolved = path.resolve(ALLOWED_ROOT, requestedPath);
const relative = path.relative(ALLOWED_ROOT, resolved);
if (relative.startsWith("..") || path.isAbsolute(relative)) {
  return new NextResponse("Forbidden", { status: 403 });
}
```

这种方式对符号链接、`..`、双斜杠、URL 编码等都有效。

### 5. Quota 限流

`src/lib/quota.ts` 实现按 user + action + day 三元组计数：

- `mineru_parse`：每人每天 10 次（admin 角色绕过）
- `chat` / `translate` / `vision`：每人每天 100 次
- 计数存储在 `DailyQuota` 表，`@@unique([userId, action, day])` 保证原子 upsert
- 时区按 UTC+8（北京时间），0 点重置
- 匿名用户（未登录）按 IP+UA hash 识别，单独限额

admin 用户在 `roleBypassesQuota()` 中返回 true，跳过所有 quota 检查，方便测试和演示。

---

## § VIII. 多 LLM 集成与自选模型接入

### 预置 5 家 + 自选 1 个 = 6 个 provider

`src/lib/llm.ts` 定义了 `LLMProvider` 类型：

```typescript
type LLMProvider = "deepseek" | "openai" | "zhipu" | "moonshot" | "anthropic" | "custom";
```

每家的预置配置在 `llm-settings-dialog.tsx` 里：

| Provider | baseUrl | 默认 model | 适用场景 |
|---|---|---|---|
| DeepSeek | api.deepseek.com | deepseek-chat | 默认 provider，国内访问稳、长文本便宜 |
| OpenAI | api.openai.com/v1 | gpt-4o-mini | 复杂推理、多模态 |
| 智谱 GLM | open.bigmodel.cn/api/paas/v4 | glm-4-flash | 国内备选、免费额度 |
| Moonshot Kimi | api.moonshot.cn/v1 | moonshot-v1-8k | 超长上下文（128k） |
| Anthropic | api.anthropic.com/v1 | claude-3-5-sonnet | 写作质量最佳 |
| **Custom** | 用户填 | 用户填 | 任意 OpenAI 兼容端点 |

### CUSTOM_LLM：接任意 OpenAI 兼容端点

这是项目的关键设计——**不锁死任何 LLM 提供商**。用户填三个 env（或在 LLM Settings Dialog 里填三个字段）就能接入：

- **vLLM 私有部署**：企业内部用 vLLM 部署 Qwen / Llama / DeepSeek 开源模型，`CUSTOM_LLM_BASE_URL=http://internal-host:8000/v1`
- **Ollama 本地**：开发者笔记本跑 Ollama，`CUSTOM_LLM_BASE_URL=http://localhost:11434/v1`，`CUSTOM_LLM_MODEL=qwen2.5:14b`
- **LM Studio**：macOS 本地 LM Studio，`CUSTOM_LLM_BASE_URL=http://localhost:1234/v1`
- **Together AI / Fireworks / Anyscale**：海外开源模型托管服务
- **公司内部 LLM 网关**：大企业自建的 LLM 中台

所有 OpenAI 兼容协议（`/v1/chat/completions` + `Authorization: Bearer`）的端点都能接。这意味着：

1. **数据隐私**：医院 / 研究所不能把患者数据发到公网 LLM？用 CUSTOM_LLM 接内部部署的 Qwen，数据全程在内网
2. **成本可控**：DeepSeek 调用量大被限速？切到自托管的 vLLM，按硬件成本算 token 几乎免费
3. **离线可用**：网络不稳定的环境（出差、飞机上）用 Ollama 本地模型，不依赖云

### 客户端动态切换

LLM 配置可以在前端 LLM Settings Dialog（齿轮图标）随时切换，通过 HTTP header 传给后端：

```
X-LLM-Provider:  custom
X-LLM-Base-Url:  http://internal-host:8000/v1
X-LLM-Api-Key:   sk-xxxxx
X-LLM-Model:     Qwen2.5-72B-Instruct
```

后端 `getLLMConfig()` 优先读 header，缺了再 fallback 到 env。同一用户可以在一次会话中先切到 GPT-4o 做复杂分析，再切到 DeepSeek 做后续追问，无需重新登录。

### 视觉模型单独配置

VLM（视觉语言模型）走独立的 `callVisionLLM()`，配置在 `VISION_API_KEY` / `VISION_BASE_URL` / `VISION_MODEL` 三个 env，默认接智谱 glm-4v-flash（国内免费额度大、对 figure 理解能力够用）。如果用户想换成 GPT-4o Vision 或 Claude 3.5 Sonnet Vision，改三个 env 即可，业务代码不需要改。

### 成本估算表

`src/lib/llm.ts` 内置了主流模型的单价表（人民币 per 1M tokens），用于 admin 面板估算成本：

```typescript
deepseek:  { "deepseek-chat": { input: 1, output: 2 } }      // ¥1/¥2 per 1M
openai:    { "gpt-4o-mini": { input: 1.05, output: 4.2 } }   // ¥1.05/¥4.2
zhipu:     { "glm-4-flash": { input: 0.1, output: 0.1 } }    // ¥0.1（几乎免费）
moonshot:  { "moonshot-v1-8k": { input: 8.4, output: 8.4 } }
anthropic: { "claude-3-5-sonnet": { input: 21.7, output: 109 } }
```

每次 `callLLM()` 调用结束后写入 `TokenUsage` 表，包含 `promptTokens` / `completionTokens` / `totalTokens` / `costCny` 四个字段。admin 面板按 provider / model / action 三维度聚合展示。

---

## § IX. 实时监控与运营面板

### Admin Dashboard 数据源

访问 `/admin` 路由（需 `role="admin"`），数据由 `/api/admin/stats` 提供。前端用 Recharts 渲染 4 类图表 + 3 张表：

**Token 消耗图表**

- **按 Provider 聚合**（Pie Chart）：DeepSeek / OpenAI / 智谱 / Moonshot / Anthropic / Custom 各自占比
- **按 Model 聚合**（Bar Chart）：每个具体 model 的 token 总量 + 调用次数
- **按 Action 聚合**（Bar Chart）：analyze / chat / translate / vision / followups / llm_test 各场景的消耗
- **按日趋势**（Line Chart）：每日 token 消耗 + 估算成本（CNY）

**用户行为图表**

- **Daily Active Users**：每日活跃用户数（Line Chart）
- **Daily Actions**：每日 analyze / chat / translate / vision / upload_pdf 调用次数（Stacked Bar Chart）

**反馈统计**

- **Feedback Summary**：up vs down 总数 + 比例（Pie Chart）
- **Down Feedback 详情表**：列出所有 thumbs-down 反馈，包含 question / answer / reason，便于发现 LLM 回答质量问题

**用户与对话表**

- **Recent Users**：最近注册的用户 + chatCount + lastActiveAt
- **Recent Chats**：最近的对话记录 + 用户邮箱 + 论文标题

### 配额监控

`DailyQuota` 表的实时聚合：

- 今日各 action 的配额使用率（已用 / 上限）
- 即将触顶的用户列表（top 5 by count）
- 重置时间倒计时（北京时间次日 0 点）

### 错误率监控

通过 `UsageEvent` 表的 `meta` 字段记录失败事件：

- MinerU 解析失败次数 + 错误类型分布（fetch failed / OOM / 超时）
- LLM 调用 5xx 错误统计
- Figure 提取失败次数

### 访问控制

- `/admin` 路由 + `/api/admin/stats` 都做 `requireAdmin()` 检查
- 普通用户访问直接 403
- admin 角色通过 `User.role="admin"` 字段控制，可在数据库手动设置第一个 admin（注册后用 sqlite3 改一行）

---

## § X. 下载与导出能力

### Markdown 智能分析版

`src/lib/export-utils.ts` 的 `exportMarkdown()` 生成结构化 .md 文件，包含：

```markdown
# {论文标题}

## 概览
- 解析时间: 2026-08-01 13:25
- 页数: 28
- Figure 数: 7

## I. 问题与背景
{questionBackground 内容，含 figure 引用}

## II. 论证主线
{argumentSpine 内容，含 chainIndex 排序}

## III. 创新性
{novelty 内容}

## IV. 局限与机会
{limitsOpportunities 内容}

## 附录：Figure Captions
### Figure 1. {caption}
### Figure 2. {caption}
...
```

文件命名 `{paper-title-slug}-analysis-{date}.md`，可直接拖进 Obsidian vault 或 Notion 数据库。所有 markdown 格式（**bold** / *italic* / `[link]()` / `<sup>`）都保留。

### HTML 思维导图

`exportMindmapHtml()` 生成一个**完全独立的 .html 文件**，包含：

- 内联 CSS（burgundy 期刊风格，与 app 内一致）
- 内联 JavaScript（Dagre 布局算法 + 节点交互）
- 4 层分析数据嵌在 `<script type="application/json">` 标签里
- 浏览器双击打开就渲染，无需服务端、无需网络

文件命名 `{paper-title-slug}-mindmap-{date}.html`，特点：

- **离线可用**：发到微信 / 邮件，对方打开就能看
- **可打印**：浏览器打印为 PDF 后贴到 PPT 里
- **可分享**：不暴露任何 API key 或服务器信息

### 设计哲学

读完后需要保存到个人知识库或汇报材料——这是阅读流量的"出口"。如果只能在线看，用户就被锁死在 MedReader 里。下载接口让 MedReader 产出的分析**可携带、可复用、可归档**，用户真正拥有自己的阅读成果。

未来计划支持 docx 格式（已在依赖里加了 `docx` 库，尚未启用），可以直接生成 Word 文档贴到基金本子里。

---

## § XI. 部署与运维

### 一键部署（Docker Compose）

**前置要求**：

- 服务器：2 vCPU / 2 GiB RAM / 20 GiB 磁盘起（推荐阿里云 ECS / 腾讯云 CVM / AWS Lightsail）
- Docker 26+ 与 Docker Compose v2.27+
- 端口 3000 开放（或用 Caddy 反代到 443）

**步骤**：

```bash
# 1. 克隆仓库
git clone https://github.com/Cymene1205/Medreader.git /opt/medreader
cd /opt/medreader

# 2. 准备 .env.production
cp .env.production.example .env.production
# 编辑 .env.production，至少填：
#   NEXTAUTH_SECRET=<openssl rand -base64 32>
#   NEXTAUTH_URL=http://your-server-ip:3000
#   MINERU_API_TOKEN=<从 mineru.net 获取>
#   DEEPSEEK_API_KEY=<从 platform.deepseek.com 获取>

# 3. 构建并启动
docker compose up -d --build

# 4. 等待健康检查（约 30 秒）
docker compose ps   # 看到 STATUS=Up X seconds (healthy) 即可

# 5. 访问
curl http://localhost:3000
```

### Caddy 反向代理（生产推荐）

```caddyfile
medreader.your-domain.com {
    reverse_proxy localhost:3000
    encode gzip
    log {
        output file /var/log/caddy/medreader.log
    }
}
```

Caddy 自动申请 Let's Encrypt 证书，无需手动管理 HTTPS。

### 资源调优（小内存服务器）

阿里云 2 GiB ECS 上跑 build 会 OOM（Next.js 16 Turbopack 编译吃 1.5GB+）。解决方案：

```bash
# 方法 1：build 时停容器，腾内存
docker compose stop medreader
docker compose stop searxng  # 如果有
NODE_OPTIONS=--max-old-space-size=1024 docker compose build medreader
docker compose up -d medreader

# 方法 2：本地 build 好镜像，scp 到服务器
# 在开发机（16G 内存）：
docker build -t medreader-medreader:latest .
docker save medreader-medreader:latest | gzip > medreader.tar.gz
scp medreader.tar.gz root@server:/opt/medreader/
# 在服务器：
docker load < medreader.tar.gz
docker compose up -d
```

### 数据持久化

`docker-compose.yml` 挂载两个卷：

```yaml
volumes:
  - ./data:/app/data          # SQLite 数据库 + 配置
  - ./uploads:/app/uploads    # 上传的 PDF + MinerU 提取的 figure 图片
```

备份只需 tar 这两个目录：

```bash
tar -czf medreader-backup-$(date +%Y%m%d).tar.gz data/ uploads/ .env.production
```

### 健康检查

`docker-compose.yml` 的 healthcheck 用 `http://127.0.0.1:3000/`（注意是 `127.0.0.1` 不是 `localhost`——容器内 localhost 解析为 IPv6 `::1`，但 Next.js standalone 只监听 IPv4 `0.0.0.0`，用 localhost 会导致 healthcheck 失败、容器被标记 unhealthy、in-flight 请求被杀）。

### 常用运维命令

```bash
cd /opt/medreader

# 看实时日志
docker compose logs -f medreader | grep -E '\[mineru\]|\[upload\]|\[figure\]'

# 拉新代码 + 重建 + 重启
git pull && docker compose up -d --build medreader

# 进容器调试
docker compose exec medreader sh

# 备份数据库
cp data/custom.db "data/custom.db.$(date +%Y%m%d).bak"

# 升级后清理旧镜像（释放 2GB+ 磁盘）
docker image prune -f
```

---

## § XII. 安全设计与开源贡献

### 认证与授权

- **NextAuth.js v4**：邮箱 + 密码注册登录，Session cookie 保持登录态
- **匿名上传已禁用**：所有上传必须登录（生产环境硬性要求，防止滥用 MinerU 额度）
- **bcryptjs 密码哈希**：salt rounds 10，不存明文
- **角色系统**：`User.role` 字段，`user` | `admin` 两级，admin 可访问 `/admin` 路由且绕过 quota 限制

### 文件安全

- **UPLOADS_DIR 隔离**：所有上传文件存 `/app/uploads/`，与系统目录隔离
- **cuid 文件名**：上传的 PDF 重命名为 cuid（如 `cms9wvlw8000...pdf`），不暴露原始文件名
- **Path 遍历防御**：见 § VII 第 4 点，`path.resolve` + `path.relative` 双重检查
- **50MB 上限**：`experimental.proxyClientMaxBodySize: "50mb"` 在 Next.js 16 配置生效

### 密钥管理

- `.env.production` 在 `.gitignore` 中，不入库
- `.env.production.example` 只提供字段名，secret 值用占位符
- 日志中所有 API key 自动 redact（`MINERU_API_TOKEN=***REDACTED***`）
- OSS presigned URL 的签名 query string 不打印到日志（只打 host）

### HTTP 安全

- **Caddy 自动 HTTPS**：Let's Encrypt 证书自动续期
- **CORS**：API 路由默认同源，跨域请求需显式配置
- **CSRF**：NextAuth 内置 CSRF token，所有非 GET 请求需带 token

### 开源协议与贡献

- **协议**：MIT，可商用、可修改、可分发，只需保留版权声明
- **依赖全部开源友好**：Next.js (MIT) / Prisma (Apache-2.0) / shadcn/ui (MIT) / Tailwind CSS (MIT) / React (MIT) / MinerU SDK (Apache-2.0) / pdfjs-dist (Apache-2.0) / Dagre (MIT) / Recharts (MIT) / NextAuth (ISC)
- **不锁死商业 SaaS**：MinerU 是云 API 但有开源版本可自托管、所有 LLM 都可换 CUSTOM_LLM、SQLite 可换 PostgreSQL，整个架构不依赖任何不可替代的商业服务
- **贡献流程**：Fork → 创建 feature branch → 提 PR → CI 通过后合并到 main
- **Issue 模板**：bug 报告 / 功能请求 / 文档改进三种模板，引导用户提供必要信息
- **代码风格**：ESLint + Prettier，TypeScript strict mode

---

## § XIII. 路线图

### 短期（v0.4，2026 Q4）

- **协作标注**：多人给同一 figure 加批注，类似 Google Docs 评论
- **Figure 跨论文对比视图**：把多篇论文的同主题 figure 放一个页面横向比较
- **引文网络图**：基于 citationsJson 可视化论文内部 figure 之间的引用关系
- **思维导图模板可选**：提供 4 层框架 / 5W1H / SWOT 等多种分析模板
- **Markdown 导出增强**：支持 docx 格式，直接生成 Word 文档

### 中期（v0.5，2027 Q1）

- **知识图谱**：从 4 层分析中抽取实体（基因 / 蛋白 / 疾病 / 药物）+ 关系，构建跨论文知识图谱
- **自定义 LLM prompt 模板**：用户可保存自己的分析 prompt，复用到不同论文
- **批量上传**：一次上传 10+ 篇论文，后台排队解析
- **PostgreSQL 迁移指南**：团队部署场景下从 SQLite 迁移到 PG 的完整文档
- **RAG 跨论文问答**：基于个人文献库做检索增强问答

### 长期（v1.0，2027 Q3）

- **自托管 MinerU**：摆脱云依赖，MinerU 开源版本本地部署
- **移动端适配**：响应式 UI + PWA，平板/手机可读
- **插件系统**：第三方可以开发自己的分析模块（比如特定领域的 figure 解析器）
- **审稿辅助模式**：upload 一篇待审稿论文，AI 按审稿人视角生成 review report
- **机构部署支持**：SSO 集成、多租户、审计日志

---

## § XIV. 限制与已知问题

诚实说明当前限制，避免用户预期落差：

1. **MinerU vlm 模式对 30+ 页大 PDF 解析 4–6 分钟**：有 10 分钟硬上限，超时后回退到 pdfjs-dist 离线解析（无 figure 提取、无 4 层分析，只能看 PDF 原文 + 翻译）。这是为了不让单个用户耗尽 MinerU 配额。

2. **单 LLM 调用无并发限制**：当前没有全局限流，极端情况（多个用户同时分析）可能触发 provider rate limit。短期靠 quota 限流兜底，长期需要加 queue。

3. **SQLite 单机部署**：不支持多实例水平扩展。如果要部署多台服务器做负载均衡，需要先迁移到 PostgreSQL（Prisma 改 connection string 即可，业务代码不动）。

4. **Figure panel 自动切分依赖 MinerU 输出质量**：复杂 figure（8+ panel、嵌套子图、非标准布局）可能漏切或错切。Call B 的 VLM 会尽力解释，但无法完全替代人工识别。

5. **1.8G 内存服务器跑 build 会 OOM**：Next.js 16 Turbopack 编译需要 1.5GB+ 内存。解决方案见 § XI 资源调优（build 时停容器 / 本地 build 后 scp 镜像）。

6. **首次启动慢**：Prisma generate + Next.js 启动 + 第一次请求冷启动，约 10–15 秒。后续请求正常。

7. **管理员面板无实时推送**：当前 admin 数据是用户主动刷新获取，不是 WebSocket 实时推送。短期够用，长期会加 SSE。

---

## § XV. 致谢与许可证

### 致谢

本项目站在众多开源项目的肩膀上，特别感谢以下工具与团队：

**核心解析与渲染**

- [**MinerU**](https://github.com/opendatalab/MinerU)（OpenDataLab，Apache-2.0）：PDF 解析基础设施，提供 block 级 `page_idx` / `bbox` / `chart_caption` 结构，让 figure 提取与 caption 对齐在工程上成为可能
- [**pdf.js**](https://github.com/mozilla/pdf.js)（Mozilla，Apache-2.0）：PDF 渲染与离线解析兜底，MinerU 失败时保证可用性
- [**JSZip**](https://github.com/Stuk/jszip)（MIT）：解压 MinerU 返回的 full_zip

**前端框架与组件**

- [**Next.js**](https://github.com/vercel/next.js)（Vercel，MIT）：App Router + RSC + Turbopack，五面板协同的架构基础
- [**React**](https://github.com/facebook/react)（Meta，MIT）：UI 范式
- [**shadcn/ui**](https://github.com/shadcn-ui/ui)（MIT）：New York 风格组件库，可复制粘贴的可控组件
- [**Tailwind CSS**](https://github.com/tailwindlabs/tailwindcss)（Tailwind Labs，MIT）：原子化样式系统
- [**Radix UI**](https://github.com/radix-ui/primitives)（MIT）：可访问性原语，shadcn/ui 底层
- [**Lucide**](https://github.com/lucide-icons/lucide)（ISC）：图标库

**数据与状态**

- [**Prisma**](https://github.com/prisma/prisma)（Apache-2.0）：类型安全 ORM，schema-first 开发体验
- [**NextAuth.js**](https://github.com/nextauthjs/next-auth)（ISC）：认证方案
- [**Zustand**](https://github.com/pmndrs/zustand)（MIT）：客户端状态管理
- [**TanStack Query**](https://github.com/TanStack/query)（MIT）：服务端状态缓存
- [**bcryptjs**](https://github.com/dcodeIO/bcryptjs)（MIT）：密码哈希

**可视化与导出**

- [**Dagre**](https://github.com/dagrejs/dagre)（MIT）：思维导图自动布局算法
- [**React Flow / XyFlow**](https://github.com/xyflow/xyflow)（MIT）：思维导图交互层
- [**Recharts**](https://github.com/recharts/recharts)（MIT）：admin 面板图表
- [**react-markdown**](https://github.com/remarkjs/react-markdown)（MIT）：Markdown 渲染
- [**docx**](https://github.com/dolanmiu/docx)（MIT）：Word 文档生成（待启用）

**LLM 与 AI**

- [**DeepSeek**](https://www.deepseek.com/)：默认 LLM provider，国内访问稳定、长文本便宜
- [**智谱 AI**](https://open.bigmodel.cn/)：GLM 系列，包括免费的 glm-4-flash 与视觉模型 glm-4v-flash
- 感谢 OpenAI / Anthropic / Moonshot 提供的兼容协议标准，让多 provider 抽象层成为可能

**部署与运维**

- [**Docker**](https://www.docker.com/)（Apache-2.0）：容器化
- [**Caddy**](https://github.com/caddyserver/caddy)（Apache-2.0）：自动 HTTPS 反向代理
- [**tini**](https://github.com/krallin/tini)（MIT）：容器 init 进程

### 关于作者

**行止集 · Biorhythm**

- 华中科技大学 · 同济医学院
- 公众号「行止集」主理人
- 联系方式：公众号留言 / GitHub Issue

> "读文献是医学研究者最日常也最寂寞的劳动。希望 MedReader Agent 能让这份劳动稍微不那么孤独。"
>
> — Biorhythm, 2026

本项目开发与维护得到**华中科技大学同济医学院基础医学院**的资助与支持。感谢学院为青年研究者提供的开放技术探索空间，让"工医交叉"的小型实验成为可能。亦感谢所有在公众号「行止集」留言、提建议、报 bug 的读者——是你们让这个项目从一份个人脚本，逐步生长为一个可被同行使用的工具。

### 红色宣传页

项目的公开 landing page（访问根路径 `/`）采用 **burgundy 期刊风**设计——深红色 (`--burgundy: #6b2737`) 配米色纸面 (`--paper: #f5efe6`)，致敬传统学术期刊的封面美学。已登录用户在 header 点"进入工作台"跳转 `/app`，未登录用户主 CTA 指向 `/login`（登录是入口，注册是次选）。

### 许可证

MIT License — 任意复制、修改、分发、商用，只需保留版权声明。

```
Copyright (c) 2026 行止集 (Biorhythm) · 华中科技大学同济医学院

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

完整许可证见 [LICENSE](LICENSE) 文件。

### 贡献指南

欢迎通过以下方式贡献：

- **Bug 报告**：[GitHub Issues](https://github.com/Cymene1205/Medreader/issues) 提交 bug，附上复现步骤与日志
- **功能请求**：同样通过 Issues，描述使用场景与期望行为
- **Pull Request**：Fork 仓库 → 创建 feature branch (`feat/your-feature`) → 提 PR → CI 通过后合并
- **文档改进**：README / DEPLOY.md / 代码注释的改进随时欢迎
- **分享反馈**：在公众号「行止集」留言或写文章分享使用体验

---

**仓库**：[github.com/Cymene1205/Medreader](https://github.com/Cymene1205/Medreader)
**作者**：[行止集 · Biorhythm](https://github.com/Cymene1205) · 华中科技大学同济医学院
**协议**：MIT
**版本**：v0.3.0 · 2026
