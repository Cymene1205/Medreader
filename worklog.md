# MedReader Agent — Work Log

---

## Task ID: f7-mindmap
**Agent:** mindmap-agent
**Task:** Implement Feature 7 (思维导图 / Mindmap) — create `src/lib/outline-to-flow.ts` and `src/components/mindmap-view.tsx` for the MedReader Agent Next.js 16 project.

### Work Log
- Read existing `src/components/outline-panel.tsx` to confirm the `Outline` / `OutlineSection` / `OutlineChild` types and their fields.
- Read `src/app/page.tsx` to confirm how `<MindmapView outline onChildClick />` is consumed inside the mindmap tab.
- Verified `@xyflow/react` v12 and `@dagrejs/dagre` v3 are installed; inspected their type exports (`Node`, `Edge`, `NodeProps`, `BackgroundVariant`, `Handle`, `Position`, `useNodesState`, `useEdgesState`, `Graph`, `rankdir: "LR"`).
- Created `src/lib/outline-to-flow.ts`:
  - Exported `FlowNode` / `FlowEdge` types (extended `data` with `isRoot`, `index`, `hasDetail` to faithfully encode the spec's "include data.summary, data.index, data.dimColor, data.detail flag" instruction while remaining backwards-compatible with the required shape).
  - Built a 3-level tree: root (`type: "input"`, paper title or `"论文"`, neutral slate `#475569`), sections (`type: "default"`, dim-1..6 colors with `borderLeft: 4px solid dimColor`), children (`type: "output"`, lighter tint of parent dim via a `lighten()` helper).
  - Edges use `type: "smoothstep"`, root→section colored by dim, section→child dim with opacity 0.55.
  - Ran dagre with `rankdir: "LR"`, `nodesep: 28`, `ranksep: 90`, `marginx/y: 24`; converted dagre center coords to ReactFlow top-left coords.
  - Section data carries `summary`, `dimColor`, `index`, `hasDetail`, `section`; child data carries `child` + `section` so the click handler can fire `onChildClick`.
- Created `src/components/mindmap-view.tsx`:
  - `"use client"`; imports `ReactFlow`, `Background`, `Controls`, `MiniMap`, `Handle`, `Position`, `useNodesState`, `useEdgesState` from `@xyflow/react` plus `import "@xyflow/react/dist/style.css"`.
  - `useMemo` over `outlineToFlow(outline)` to recompute layout on outline change; syncs into `useNodesState` / `useEdgesState` via `useEffect`.
  - Custom `DimNode` renderer (memoized) branches on `data.isRoot` / `data.isSection` / child presence. Section card shows dim number badge + title + 1-line summary with a 4px colored left border; child card uses the lighter dim background.
  - `nodeTypes` maps `input` / `default` / `output` / `dimNode` to `DimNode` so the type fields produced by `outline-to-flow.ts` are honored while still using a single custom renderer.
  - `onNodeClick` fires `onChildClick(data.child, data.section)` for child nodes, and synthesizes `{id, title, quote, keywords: []}` for section nodes that have a `quote`.
  - ReactFlow props: `fitView`, `proOptions={{ hideAttribution: true }}`, `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={true}`.
  - `<Background color="#E5E9EE" gap={20} variant={BackgroundVariant.Dots} />`, `<MiniMap pannable zoomable nodeColor={data.dimColor || fallback} />`, `<Controls />`.
  - Canvas wrapped in `bg-muted` (light gray) per spec.
  - Empty state: `outline === null` → "导入 PDF 后自动生成思维导图"; sections empty → "正在分析…".
- Ran `bun run lint` → no errors.
- Ran `tsc --noEmit` → no errors in my files (pre-existing errors in `examples/`, `skills/`, `src/lib/deepseek.ts` are unrelated).
- Verified dev log shows `GET / 200` after the new files were created.

### Stage Summary
Feature 7 mindmap is fully implemented. The `outlineToFlow` helper produces a 3-level horizontal tree (root → 6 dim sections → children) with dagre LR layout and smoothstep edges, color-coded by dimension. The `MindmapView` component renders it with a custom `DimNode` renderer, a dotted `#E5E9EE` background, a colored MiniMap, and Controls. Clicking a child or a section-with-quote triggers the parent's `onChildClick` to jump to the PDF highlight. Both empty states are handled. No new packages were installed and no other files were modified.

### Files Created
- `src/lib/outline-to-flow.ts`
- `src/components/mindmap-view.tsx`
- `agent-ctx/f7-mindmap-mindmap-agent.md` (this agent's work record)

---

## Task ID: f2-admin
**Agent:** admin-agent
**Task:** Implement Feature 2 (admin dashboard) — `src/app/api/admin/stats/route.ts` + `src/app/admin/page.tsx` for the MedReader Agent Next.js 16 project.

### Work Log
- Read `prisma/schema.prisma`, `src/lib/auth.ts`, `src/lib/db.ts`, `src/middleware.ts` to confirm the auth/role plumbing and the exact model column names.
- Read `src/app/globals.css` to verify the CSS variable palette resolves to the spec hex colors:
  - `--primary` = `#2C5F8D` (line chart)
  - `--dim-1..5` = `#2C5F8D / #3F8E83 / #6B5B95 / #C08552 / #5B8C5A` (analyze/chat/translate/vision/upload_pdf)
  - `--success` = `#5B8C5A` (pie up), `--destructive` = `#B0546E` (pie down)
  - `.glass-header` is `color-mix(in srgb, var(--foreground) 95%, transparent)` + `color: var(--background)` — matches the "bg-foreground text-background dark header (like home)" requirement, and is the same class used by the home page header.
- Found both target files already existed (created in a prior un-logged pass). Reviewed them line-by-line against the spec.
- `src/app/api/admin/stats/route.ts` — confirmed:
  - `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` ✓
  - `getServerSession(authOptions)` → 403 when no session or `role !== "admin"` ✓
  - 30-day cutoff via `new Date(Date.now() - 30*24*3600*1000)` ✓
  - SQLite raw SQL with `date(createdAt/1000, 'unixepoch')` for date truncation (Prisma v6 stores DateTime as INTEGER ms; Prisma's `groupBy` cannot do date truncation on SQLite so raw SQL is the correct equivalent).
  - `toIsoDate()` helper coerces BigInt/Date/number/string safely.
  - Returns `dailyActive`, `dailyActions` (5 actions zero-filled), `feedbackSummary`, `recentUsers` (with lastActiveAt from MAX(UsageEvent.createdAt) subquery + chatCount subquery), `recentChats`, `downFeedbacks` (with both `answer` truncated 200 + `answerFull` for the inline expand feature), plus `totalUsers`/`totalChats` for the top stat cards.
- `src/app/admin/page.tsx` — confirmed:
  - `"use client"`; on mount `fetch("/api/admin/stats", { cache: "no-store" })`; 403 → "需要管理员权限" Card with link to `/login`; generic error → "加载失败" Card; loading → `Skeleton` placeholders.
  - `Header` subcomponent uses `glass-header h-12` (same as home) with Shield icon, "管理员后台", back-to-home Button.
  - Top row: 3 `StatCard`s (总用户数 / 总对话数 / 总点踩数).
  - Charts row (recharts `ResponsiveContainer width="100%" height={300}`): `LineChart` stroke `var(--primary)` (= #2C5F8D); stacked `BarChart` with 5 `Bar` series fills from `DIM_COLORS = [var(--dim-1)..var(--dim-5)]` (= the 5 spec hexes); `PieChart` donut with two `<Cell>`s `var(--success)` (= #5B8C5A) + `var(--destructive)` (= #B0546E).
  - Two-column row: `最近用户` table (邮箱/注册时间/最近活跃/对话总数 with `Badge`) and `最近对话` table (用户/问题摘要/时间 + paper title subtitle), both in `max-h-[280px] overflow-y-auto scrollbar-thin`.
  - Bottom `点踩回答收集` card: filters (two `<input type="date">` + email text `<Input>` + 清除 button + count readout), `Table` with sticky header, columns 时间/用户邮箱/原问题/原回答(截断+点击展开全文)/点踩原因, row click toggles `expandedId` to expand `answerFull` inline with `ChevronDown`/`ChevronRight`.
  - Sticky footer (`mt-auto`) with "MedReader Agent · 管理员后台" + 返回首页 link.
  - All colors via CSS variables (per spec) which resolve to the exact spec hexes.
  - shadcn `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` used throughout.
  - Responsive `grid-cols-1 sm:grid-cols-3` / `lg:grid-cols-3` / `lg:grid-cols-2`.
- **Bug fixed:** spec lists the `recentChats` field as `userEmail` (camelCase) but the existing code emitted `user_email` (snake_case) in both `route.ts` and the frontend type/usage. Renamed to `userEmail` in:
  - `src/app/api/admin/stats/route.ts` — `recentChats` mapper field name.
  - `src/app/admin/page.tsx` — `RecentChat` type field + `c.user_email` → `c.userEmail` in the 最近对话 table.
- Ran `bun run lint` → clean (no output, exit 0).
- Ran `npx tsc --noEmit` filtered for `admin|stats` → no errors in the two files touched.
- `dev.log` shows `GET / 200` responses; pre-existing `[next-auth][error][NO_SECRET]` warnings are an env-only quirk unrelated to this task.

### Stats query approach
- Single GET handler, defensive role check after middleware gate.
- 30-day cutoff = `Date.now() - 30*24*3600*1000`.
- `dailyActive`: `SELECT date(createdAt/1000,'unixepoch') AS date, COUNT(DISTINCT userId) AS users FROM UsageEvent WHERE createdAt >= ? AND userId IS NOT NULL GROUP BY date … ORDER BY date ASC`.
- `dailyActions`: `SELECT date(…), action, COUNT(*) FROM UsageEvent WHERE createdAt >= ? GROUP BY date, action`; pivoted in JS into `{date, analyze, chat, translate, vision, upload_pdf}` with zero-fill for missing actions.
- `feedbackSummary`: `SELECT type, COUNT(*) FROM Feedback GROUP BY type` → `{up, down}`.
- `recentUsers`: `SELECT u.*, (SELECT MAX(e.createdAt) FROM UsageEvent e WHERE e.userId=u.id) AS lastActiveAt, (SELECT COUNT(*) FROM ChatLog c WHERE c.userId=u.id) AS chatCount FROM User u ORDER BY u.createdAt DESC LIMIT 10`.
- `recentChats`: `SELECT c.id, c.question, c.paperTitle, c.createdAt, u.email AS userEmail FROM ChatLog c LEFT JOIN User u ON c.userId=u.id ORDER BY c.createdAt DESC LIMIT 10` — question truncated to 80 chars in JS.
- `downFeedbacks`: `SELECT f.*, u.email AS userEmail, c.question, c.answer FROM Feedback f LEFT JOIN User u … LEFT JOIN ChatLog c … WHERE f.type='down' ORDER BY f.createdAt DESC` — answer truncated to 200 chars (`answer`) plus full text (`answerFull`) for the expand feature.
- `totalUsers` + `totalChats`: `db.user.count()` + `db.chatLog.count()` in parallel via `Promise.all`.

### Lint fixes
- No lint errors encountered. Only the `user_email` → `userEmail` rename was needed to match the spec field name; lint and tsc both pass after the fix.

### Files Touched
- `src/app/api/admin/stats/route.ts` — renamed `user_email` → `userEmail` in the `recentChats` mapper.
- `src/app/admin/page.tsx` — renamed `RecentChat.user_email` → `userEmail` (type field + usage in the 最近对话 table cell).
- `agent-ctx/f2-admin-admin-agent.md` — this agent's work record.

### Stage Summary
Feature 2 (admin dashboard) is fully implemented and spec-compliant. The API route defensively re-checks `role === "admin"` even though middleware already gates the path, computes 30-day daily active users / daily action breakdowns via SQLite raw SQL with `date(createdAt/1000, 'unixepoch')` truncation (BigInt-safe coercion via `toIsoDate`), and returns totals + recent lists + all down-vote feedbacks with full answer text for inline expansion. The client page renders three recharts visualizations (line / stacked bar / donut pie) using CSS variables that resolve exactly to the spec hex colors, two scrollable recent-user/recent-chat tables, and a filterable down-feedback table with click-to-expand answer rows. Loading (Skeleton) and error (403 / generic) states are handled. Lint and TypeScript checks pass.

---
Task ID: v4-mineru-rebuild
Agent: main (Super Z)
Task: 把 MedReader Agent 改造为 MinerU 驱动的分块阅读 + 单击段落翻译 + 6 维度大纲跳转 + 每日配额

Work Log:
- 调研 MinerU 云 API：POST /api/v4/file-urls/batch → PUT 上传 → GET /api/v4/extract-results/batch/{id} 轮询 → ZIP 含 full.md + content_list.json + images/
- 更新 Prisma schema：Paper 表加 markdown/blocksJson/imagesDir/pageCount/mineruTaskId 字段；新建 DailyQuota 模型
- 安装 jszip + remark-gfm + rehype-raw
- 新建 src/lib/mineru.ts：MinerU 云 API 客户端，返回 markdown + blocks + imagesDir
- 改写 src/lib/pdf-parse.ts：MinerU 为主路径，pdfjs-dist（修复 worker）兜底
- 新建 src/lib/quota.ts：每日额度检查（mineru_parse: 10/天, chat: 50/天, translate: 100/天, vision: 20/天）
- 改写 src/app/api/upload/route.ts：MinerU 后台解析 + 配额检查 + 错误兜底
- 改写 src/app/api/paper/[id]/route.ts：返回 markdown + blocks + imagesDir
- 新建 src/app/api/paper-images/route.ts：服务 MinerU 抽取的图片（含目录穿越防护）
- 改写 src/app/api/analyze/route.ts：优先用 markdown 作为输入（max 60k chars）
- 改写 src/app/api/chat/route.ts：system prompt 始终含 markdown 全文（16k）作上下文 + 配额
- 改写 src/app/api/translate/route.ts + vision/route.ts：加配额检查
- 新建 src/components/block-reader.tsx：MinerU 分块渲染（标题/段落/表格/图表/公式）+ 单击段落翻译 + 大纲点击高亮跳转
- 改写 src/components/translation-panel.tsx：段落翻译历史栈（最新置顶）
- 改写 src/app/page.tsx：3 Tab 布局（分块阅读默认/PDF/思维导图）+ MinerU 解析状态提示
- 改写 src/components/chat-panel.tsx：优先用 paperMarkdown 作上下文
- 加 CSS：block-flash 动画 + block-reader-table 表格样式
- 加 instrumentation.ts：捕获未处理异常，避免后台 MinerU 任务崩溃整个进程
- 端到端测试：上传 sample-paper.pdf → MinerU 4s 解析 → 6 维度大纲生成（15s）→ 段落翻译 → Agent 提问基于论文回答
- 浏览器截图验证：分块阅读显示标题/段落/章节/页码；段落蓝色高亮 + 翻译卡片显示原文+译文；6 维度大纲全部生成；Agent 回答正确引用 TNBC/CD8+/TRM cells

Stage Summary:
- MinerU 集成完成：每个 PDF 都解析为 markdown + blocks，作为知识库长期存储
- 大纲生成不再失败（之前 pdfjs worker 报错导致文本提取失败）
- Agent 提问不再返回相同答案（之前 paperText 为空导致 DeepSeek 无法基于论文回答）
- 大纲点击可跳转到 markdown 对应 block（通过 quote/keywords 模糊匹配）
- 段落单击触发整段翻译（替换之前的选词翻译）
- 每日额度：匿名用户 10 PDF/天、50 提问/天、100 翻译/天、20 图片提问/天
- 渐进式加载：MinerU 解析期间显示快速文本预览，完成后切换到结构化分块视图

---
Task ID: v5-polish
Agent: main (Super Z)
Task: 根据用户反馈修复 10 个问题：导图太简单、LLM 模型可换、点击翻译没生效、markdown 渲染、跳转乱跳、翻译不显示原文、PDF 跳转崩溃、论证思路单独提问、Result 大标题缩略框、中间查找框

Work Log:
- 新建 src/lib/llm.ts：LLM 服务商抽象层，支持 deepseek/openai/zhipu/moonshot/anthropic/custom 6 种 OpenAI 兼容 provider
  - resolveLLMConfig(req) 从请求头 X-LLM-Provider/X-LLM-Base-Url/X-LLM-Api-Key/X-LLM-Model 读取用户配置，缺失时回退 env 默认
  - callLLM / streamLLM 走标准 OpenAI 兼容 /chat/completions 端点
  - callVisionLLM 在非 deepseek provider 下走标准多模态消息；deepseek 仍走 z-ai-web-dev-sdk
  - parseJsonLoose 容错 JSON 解析（剥 markdown 代码块、找首尾 {}）
- 改写 src/lib/deepseek.ts：变成 src/lib/llm.ts 的兼容 shim，保留 callDeepSeek/streamDeepSeek/callVision 旧 API，内部转调 getDefaultLLMConfig() + callLLM/streamLLM
- 改写 5 个 API route 全部接入新抽象：
  - /api/analyze：6 个维度并行调用（Promise.all），每个维度独立 system+user prompt，输出 300-600 字 detail + 3-5 keyPoints + 2-5 children + 原文 quote
  - /api/chat：streamLLM 替换 streamDeepSeek
  - /api/translate /api/vision /api/followups：callLLM 替换 callDeepSeek
- /api/analyze 同时从 MinerU markdown 抽取 H2/H3 标题（extractHeadings），作为 outline.headings 返回，作为精确锚点
- 新建 /api/llm-test：用配置发一条 1+1= 测试消息，验证连通性
- 新建 src/components/llm-settings-dialog.tsx：
  - 6 个 provider preset（DeepSeek/OpenAI/智谱/Moonshot/Anthropic/自定义）
  - 表单：provider / baseUrl / apiKey (含眼睛切换显示) / model
  - "测试连接" 按钮 → /api/llm-test 返回 ok/失败信息
  - localStorage 持久化（key: medreader.llm.settings.v1）
  - 导出 useLLMHeaders / refreshLLMHeaders / hasUserLLMConfig 三个工具
- 改写 src/components/block-reader.tsx：
  - 段落文本走 ReactMarkdown 渲染（disallowedElements: p/h1-6/br/hr/img/ul/ol/li/blockquote/code/pre，unwrapDisallowed），inline **bold**/*italic*/sup/sub 正确显示
  - cleanMinerUText 清理 MinerU 过度转义（\* → *、\_ → _、中段 \# → #）
  - findBlockIndex 重写为打分式：exact quote +1000、quote head +800、关键词按长度加权 +25~300、token overlap +200 比例分；score=0 时不跳转（修复"乱跳"问题）
  - 新增查找框（Ctrl+F 唤起 / Esc 关闭）：高亮所有命中块（amber 色左边条）、显示 N/M 计数、上下翻动跳转
  - 表格 caption/footnote 类型守卫（typeof string）避免渲染数组
  - 每个 block 加 scroll-mt-4 让 scrollIntoView 不被顶栏遮挡
- 改写 src/components/translation-panel.tsx：
  - 删除"原文"块，只显示"译文"（用户要求）
  - 保留历史栈（最新置顶），右下角 #N 计数
  - 接收 llmHeaders prop 透传到 /api/translate
- 改写 src/components/heading-navigator.tsx：左下角新增"原文段落导航"折叠面板，列出 outline.headings 全部 H2/H3 标题，点击 → setHighlightToken({quote: h.text}) 跳转到 block reader 对应标题块
- 改写 src/components/outline-panel.tsx：Outline 类型加 headings?: PaperHeading[]
- 改写 src/lib/outline-to-flow.ts：FlowNode.data 加 detail/keyPoints/quote 字段；SECTION_SIZE 增大到 280×140；CHILD_SIZE 增大到 220×72
- 改写 src/components/mindmap-view.tsx：section 节点显示 title + summary（2行） + 最多 3 个 keyPoints（bullet list）；child 节点显示 title + summary（2行）
- 改写 src/app/page.tsx：
  - 顶栏新增"模型设置"按钮（未配置时显示 amber 警告图标 + 顶部黄底提示条）
  - onChildClick/onHeadingClick 不再强制 setActiveView("blocks")，只有 mindmap 视图时才切回 blocks（修复"PDF 跳转就消失"）
  - 左侧 Panel 内分两部分：上方 OutlinePanel（flex-1），下方 HeadingNavigator（flex-shrink-0）
  - llmHeaders state + 透传给 ChatPanel / TranslationPanel
  - onHeadingClick 用 heading.text 作为 quote（精确锚点），keywords=[]，findBlockIndex 会因为 quote head 完全匹配得 +800 分
- 改写 src/components/chat-panel.tsx：新增 llmHeaders prop，所有 fetch 调用（/api/chat、/api/vision、/api/followups）的 headers 合并 headersRef.current
- 端到端验证：
  - /api/llm-test 用 deepseek 配置调用返回 "2"（1+1=2）
  - /api/analyze 用真实论文 markdown 调用，12.9s 返回 6 个 section（detail 778-1256 字、keyPoints 4-5 个、children 3-5 个）+ 10 个 H2/H3 headings（含 "RESULTS"、"Time-Dependent Transcriptional Heterogeneity..."）
  - tsc --noEmit 通过（src/ 0 errors，skills/ 1 个无关错误）
  - dev server 编译 / 200 OK

Stage Summary:
- 大纲"太简单"问题解决：6 个维度现在并行调用 DeepSeek，每个维度独立 system prompt + 全文输入，输出 300-600 字 detail + 3-5 keyPoints + 2-5 children（之前单次调用全 6 维度，输出被压缩）
- "预留 LLM API 接口"完成：右上角"模型设置"对话框可选 6 种 provider，apiKey/baseUrl/model 三栏可自定义，"测试连接"按钮实时验证，配置存 localStorage 通过 HTTP header 传给服务端，所有 5 个 LLM API 路由统一从 header 读
- "结构化点击翻译没做出来"解决：BlockReader 段落文本现在走 ReactMarkdown，inline 加粗/斜体正确显示；点击触发 onParagraphClick 翻译整段
- "markdown 看着像 html"解决：MinerU 过度转义的 \* \_ \# 被清理；表格 table_body 仍走 ReactMarkdown+rehypeRaw（本就是 HTML）；段落文本 disallowed block-level 元素，只渲染 inline markdown
- "点击跳转乱跳转"解决：findBlockIndex 改为打分制，score=0 时返回 -1 不跳转；quote 完全匹配 +1000、quote 头部 +800、关键词按长度加权；heading 用 verbatim 论文标题作 quote 必中
- "翻译那里不用显示原文"完成：TranslationPanel 删除"原文"块，只显示译文
- "原文 PDF 跳转就报错消失"解决：onChildClick 不再强制 setActiveView("blocks")，PDF tab 不会被切走；只有 mindmap tab 下点击会切回 blocks（mindmap 本身无法显示跳转）
- "论证思路应该单独提问一次"完成：6 个维度各自独立调用 DeepSeek，输出详细程度显著提升（论证思路 section 885 字 detail + 5 个 children）
- "Result 部分大标题单独放出来"完成：/api/analyze 从 MinerU markdown 抽取所有 H2/H3 headings，返回 outline.headings；左下角 HeadingNavigator 折叠面板列出，点击即跳转到对应标题块（用 verbatim 标题文本作 quote，必中精确锚点）
- "中间缺少查找框"完成：BlockReader 顶栏新增"查找"按钮 + Ctrl+F 快捷键；查找框支持上下翻动、命中块用 amber 左边条标记、显示 N/M 计数
- 思维导图变丰富：section 节点显示 title + 2 行 summary + 3 个 keyPoints bullet；child 节点显示 title + 2 行 summary；尺寸从 240×92/200×60 增大到 280×140/220×72

Files Created:
- src/lib/llm.ts
- src/components/llm-settings-dialog.tsx
- src/components/heading-navigator.tsx
- src/app/api/llm-test/route.ts
- scripts/check-db.js (debugging only)
- scripts/test-analyze.js (debugging only)

Files Modified:
- src/lib/deepseek.ts (rewritten as shim)
- src/lib/outline-to-flow.ts
- src/components/block-reader.tsx (rewritten)
- src/components/translation-panel.tsx (rewritten)
- src/components/outline-panel.tsx (added PaperHeading/Outline.headings type)
- src/components/mindmap-view.tsx (enriched node renderers)
- src/components/chat-panel.tsx (added llmHeaders prop)
- src/app/page.tsx (rewritten — LLM UI, no force-switch, heading navigator)
- src/app/api/analyze/route.ts (rewritten — 6 parallel calls + headings extraction)
- src/app/api/chat/route.ts
- src/app/api/translate/route.ts
- src/app/api/vision/route.ts
- src/app/api/followups/route.ts

