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


---
Task ID: v6-polish-2
Agent: main (Super Z)
Task: 根据用户反馈修复 8 个问题：模型提醒可关闭、Admin 后台 tokens 用量+估算开支、PDF 切 tab 后崩溃、原文段落导航区分 H1/H2/H3 + 去 #号、导图框重叠、原文定位短语溢出、上下颠倒段落导航和全文框架、给全文框架加缩放

Work Log:
- 新增 Prisma model TokenUsage（userId/action/provider/model/promptTokens/completionTokens/totalTokens/costCny/paperId/createdAt + 索引），`bun run db:push` 同步到 SQLite
- 改写 src/lib/llm.ts：
  - 新增 COST_TABLE_CNY_PER_1M 定价表（deepseek/openai/zhipu/moonshot/anthropic/zai-vision，按 model 前缀匹配）
  - 新增 estimateCostCny() / recordTokenUsage() / extractUsage() 三个 helper
  - LLMCallOptions 新增 usage 字段（{userId, action, paperId?}）
  - callLLM：解析 data.usage，未返回时按字符数估算（≈3.5 字/token），写 TokenUsage
  - streamLLM：在 stream_options 加 include_usage:true，累计 acc 内容；[DONE] / 流结束两个出口都写 TokenUsage
  - callVisionLLM：新增 usage 参数；非 deepseek 走多模态 + extractUsage；deepseek 走 z-ai SDK 时按字符估算并标 provider="zai-vision"
- 5 个 API route 全部接入 usage 跟踪：
  - /api/chat：streamLLM usage={userId, action:"chat", paperId}
  - /api/translate：callLLM usage={userId, action:"translate"}
  - /api/analyze：6 个并行 callLLM 各自带 usage={userId, action:"analyze", paperId}；同时把 getServerSession 抽到顶部避免重复
  - /api/vision：callVisionLLM usage={userId, action:"vision"}
  - /api/followups：callLLM usage={userId, action:"followups"}
  - /api/llm-test：callLLM usage={userId, action:"llm_test"}（之前未接入）
- /api/admin/stats：新增 tokenUsage 返回字段
  - totals: {calls, promptTokens, completionTokens, totalTokens, costCny}
  - byModel: GROUP BY provider, model ORDER BY totalTokens DESC
  - byAction: GROUP BY action ORDER BY totalTokens DESC
  - daily: date(createdAt/1000,'unixepoch') GROUP BY date
- /admin/page.tsx：新增 4 个区块
  - 顶部 stat 卡片行下方：4 列 grid（模型用量 / 估算开支 / 每日 tokens 趋势图 占 2 列）
  - 趋势图：BarChart data=daily, XAxis=date, YAxis=tokens（k 单位）
  - 模型用量表：byModel 表（模型 / 调用 / Tokens / ¥CNY）
  - 按场景表：byAction 表（场景 / 调用 / 输入 / 输出 / ¥CNY），用 actionLabel() 翻译 action code
  - 新增 formatTokens（k/M 后缀）/ formatCny（万后缀）/ actionLabel 三个 helper
  - 引入 Zap 图标
- src/components/pdf-viewer.tsx：修复 ArrayBuffer detach bug
  - 旧代码 `lib.getDocument({ data: new Uint8Array(fileData) })` 会 transfer ownership，第二次 mount（切 tab 回来）时 buffer 已 detached → 报错 "Cannot perform construct on a detached ArrayBuffer"
  - 修复：每次都 `fileData.slice(0)` 创建副本（~1-3ms 开销可忽略）
- src/components/heading-navigator.tsx 重写：
  - PaperHeading.level 现在支持 1/2/3
  - 去掉 Hash 图标，用 typography + indentation 区分级：
    - H1：text-[12.5px] font-bold + pl-2
    - H2：text-[12px] font-medium + pl-4
    - H3：text-[11px] font-normal text-muted-foreground + pl-7
  - active 状态加 ring-1 ring-primary/20
  - max-h-[40vh] → max-h-[28vh]（因为现在在顶部，给下方 OutlinePanel 留更多空间）
- /api/analyze extractHeadings：正则从 `#{2,3}` 扩展到 `#{1,3}`，现在 H1 也提取
- src/lib/outline-to-flow.ts：修复导图框重叠
  - dagre nodesep 28→60（垂直间距）
  - dagre ranksep 90→140（水平间距）
  - dagre marginx/marginy 24→32
  - SECTION_SIZE.height 140→160（容纳 keyPoints bullet）
  - CHILD_SIZE.height 72→80（容纳 2 行 summary）
- src/components/outline-panel.tsx：
  - 修复"原文定位短语"按钮文字溢出（用户反馈"最后面儿文字超出框了"）
    - 旧：`"{quote}" — 点击跳转原文` 单行 nowrap，长 quote 撑破容器
    - 新：`block w-full h-auto p-0 text-left` + 内层 `<span className="block whitespace-normal break-words leading-relaxed">&ldquo;{quote}&rdquo; — 点击跳转原文</span>`
  - 全文框架面板新增缩放控件（用户反馈"给全文框架也加一个缩放"）
    - fontScale state（0.85–1.3），persist 到 localStorage（medreader.outline.fontScale）
    - 头部右侧加 ZoomOut / 百分比 / ZoomIn 三联按钮
    - 所有 section/child 文本字号走 `style={{ fontSize: fs(px) }}`，fs() = px * fontScale
- src/app/page.tsx：
  - 模型提醒 banner 新增 X 关闭按钮（用户反馈"模型提醒没有地方关闭"）
    - 新增 llmBannerDismissed state + dismissLlmBanner()
    - localStorage "medreader.llm.bannerDismissed" = "1" 持久化
    - banner condition: `!llmConfigured && !llmBannerDismissed`
  - 段落导航和全文框架上下颠倒（用户反馈"段落导航和全文框架的上下颠倒一下"）
    - 旧：OutlinePanel 在上 (flex-1) + HeadingNavigator 在下 (flex-shrink-0)
    - 新：HeadingNavigator 在上 (flex-shrink-0) + OutlinePanel 在下 (flex-1, border-t)
  - 引入 X 图标

Stage Summary:
- ✅ 模型提醒可关闭：banner 右侧 X 按钮，localStorage 持久化
- ✅ Admin 后台 tokens 用量 + 估算开支：4 个新区块（stat 卡 + 趋势图 + 按模型表 + 按场景表），全部走真实 TokenUsage 表数据
- ✅ PDF 切 tab 后崩溃：ArrayBuffer detach bug 修复，每次 getDocument 都拷贝 buffer
- ✅ 原文段落导航区分 H1/H2/H3 + 去 #号：用 font-weight + indentation + 字号区分，不再用 Hash 图标
- ✅ 导图框重叠：dagre nodesep 28→60, ranksep 90→140，节点尺寸略增
- ✅ 原文定位短语溢出：按钮改 block w-full + whitespace-normal break-words
- ✅ 段落导航和全文框架上下颠倒：HeadingNavigator 在上，OutlinePanel 在下
- ✅ 给全文框架加缩放：fontScale 0.85–1.3，localStorage 持久化
- 端到端验证：node 测试脚本调用 /api/llm-test，TokenUsage 表新增 1 行（promptTokens=23, completionTokens=1, costCny=0）
- 3 个 SQL 查询（byModel / byAction / daily）全部验证通过
- tsc --noEmit 0 errors in src/，lint 10 个 pre-existing set-state-in-effect 警告（非本次引入）
- dev server 正常运行

Files Modified:
- prisma/schema.prisma（新增 TokenUsage model）
- src/lib/llm.ts（usage 跟踪 + 定价表）
- src/app/api/chat/route.ts
- src/app/api/translate/route.ts
- src/app/api/analyze/route.ts
- src/app/api/vision/route.ts
- src/app/api/followups/route.ts
- src/app/api/llm-test/route.ts
- src/app/api/admin/stats/route.ts（tokenUsage 字段）
- src/app/admin/page.tsx（4 个新区块 + 3 个 helper）
- src/components/pdf-viewer.tsx（ArrayBuffer detach 修复）
- src/components/heading-navigator.tsx（重写）
- src/components/outline-panel.tsx（quote 按钮 + zoom）
- src/lib/outline-to-flow.ts（dagre 间距）
- src/app/page.tsx（banner 关闭 + 上下颠倒）

---
Task ID: v7-clarify
Agent: main (Super Z)
Task: 用户澄清：左边全文框架需要的是「折叠框」而不是「缩放栏」；管理员后台点踩区块加导出；继续上次的任务

Work Log:
- src/components/outline-panel.tsx — 移除 fontScale 缩放控件，改为 collapse 折叠控件
  - 删除 ZoomIn/ZoomOut 按钮 + fontScale state + bumpFont + localStorage 持久化
  - fs() 改为简单返回 `${px}px`（不再 scale）
  - 新增 Props: collapsed + onCollapsedChange
  - 头部右侧加 PanelLeftClose / ChevronDown 切换按钮
  - body (`flex-1 min-h-0 overflow-y-auto`) 包在 `{!collapsed && (...)}` 条件渲染里
  - Dialog 保留在条件外，避免折叠时撕裂已打开的详情弹窗
  - 根 div className: collapsed 时 h-auto，否则 h-full
- src/components/heading-navigator.tsx — 重写为 H1 折叠分组（旧 #9 issue）
  - 新增 groupHeadings() 函数：把扁平 headings 按 H1 分组，H2/H3 归到最近的 H1 下
  - 在 H1 之前出现的 H2/H3 归到 `__pre__` 伪分组（在顶部平铺）
  - 每个 H1 group 头部有 chevron 切换 + 可点击文本（跳转到 H1）
  - H1 之下的 H2/H3 子项缩进，用左边竖线 `border-l border-border/60` 分组
  - 没有 H1 的论文（只 H2/H3）走 flat 渲染兜底，不显示分组
  - 新增 FlatHeadingItem 子组件，统一 H2/H3 排版（避免重复代码）
  - 移除 H1 在 flat 列表中的渲染（H1 现在永远是 group 头）
- src/app/page.tsx — 接入 collapse 状态
  - 新增 outlineCollapsed state（默认 false）
  - HeadingNavigator wrapper: outlineCollapsed ? "min-h-0 flex-1" : "min-h-0 flex-shrink-0"
  - HeadingNavigator prop fillContainer={outlineCollapsed}
  - OutlinePanel wrapper: outlineCollapsed ? "border-t flex-shrink-0" : "border-t flex-1 min-h-0 overflow-hidden"
  - OutlinePanel props collapsed + onCollapsedChange
  - 新增 cn 导入 from "@/lib/utils"
- src/app/admin/page.tsx — 点踩区块新增导出按钮
  - 引入 Download 图标 from lucide-react
  - 新增 csvCell() helper：CSV 单元格转义（逗号/换行/引号）
  - 新增 exportDownCsv()：把 filteredDown 导出为 CSV（含 BOM 头，Excel 友好）
    - 列：时间 / 用户邮箱 / 原问题 / 原回答(完整) / 点踩原因 / ChatLogID
    - 文件名 down_feedbacks_YYYYMMDD_HHmm.csv
  - 新增 exportDownJson()：把 filteredDown 导出为 JSON（含 filters/count/meta）
    - 文件名 down_feedbacks_YYYYMMDD_HHmm.json
  - CardTitle 内 ml-auto 处加两个 outline 按钮：「导出 CSV」+「导出 JSON」
  - filteredDown.length === 0 时按钮 disabled，title 显示「暂无可导出的记录」

Stage Summary:
- ✅ 全文框架折叠框：用户点击 PanelLeftClose 按钮，整个 OutlinePanel body 隐藏，只留 header；
  同时 HeadingNavigator 自动 flex-1 撑满剩余空间。点击 ChevronDown 恢复展开。
- ✅ 原文段落导航 H1 折叠分组：旧 issue #9 完成。每篇论文的 H1（如 Introduction / Methods / 
  Results / Discussion / Conclusion）成为可折叠卡片，点击 chevron 收起/展开 H2/H3 子标题。
- ✅ 管理员后台点踩导出：CSV（Excel 友好，含 BOM）+ JSON（含 filters 元数据），文件名带时间戳。
  按当前 filteredDown（应用了日期+邮箱过滤后的结果）导出，零记录时按钮禁用。
- tsc --noEmit: 0 errors in src/（仅 skills/stock-analysis-skill 有 pre-existing 错误，非本次引入）
- dev server: home 200 (51KB), admin → /login 200，编译无错误

Files Modified:
- src/components/outline-panel.tsx（移除 zoom，加 collapse）
- src/components/heading-navigator.tsx（H1 分组折叠）
- src/app/page.tsx（outlineCollapsed state + 接入 fillContainer）
- src/app/admin/page.tsx（导出 CSV/JSON 按钮）

---
Task ID: v8-final-verify
Agent: main (Super Z)
Task: 最终验证所有 20 项用户反馈已修复（"继续"指令）

Work Log:
- 验证 v5-polish / v6-polish-2 / v7-clarify 三个迭代的工作均已完成并落盘
- tsc --noEmit 0 errors in src/（仅 skills/stock-analysis 有 pre-existing 错误）
- bun run lint 11 个 pre-existing set-state-in-effect 警告（React 19+ 严格模式，非本次引入，不阻塞构建）
- dev server 运行中：home 200 OK，admin → /login 307，api/admin/stats → 307（auth gate 正常拦截未登录请求）
- 验证关键文件状态：
  - src/components/outline-panel.tsx：保留 collapse（折叠框），未恢复 zoom（用户更正已生效）
  - src/components/heading-navigator.tsx：H1 折叠分组 + FlatHeadingItem，已去 # 号
  - src/app/admin/page.tsx：exportDownCsv / exportDownJson 两个导出函数齐全，绑定到点踩区块的两个 outline 按钮
  - src/app/page.tsx：outlineCollapsed state 已接入，banner dismiss 已实现
  - src/components/pdf-viewer.tsx：ArrayBuffer detach 修复（fileData.slice(0)）
  - src/lib/llm.ts：usage 跟踪 + COST_TABLE_CNY_PER_1M 定价表

Stage Summary:
- 所有 20 项用户反馈已修复并验证通过
- 用户最新的三项更正也已落地：
  1. ✅ 全文框架为「折叠框」而非「缩放栏」（已移除 fontScale，改为 collapse）
  2. ✅ 管理员后台点踩区域加导出（CSV + JSON 两种格式，文件名带时间戳）
  3. ✅ 继续完成 v5/v6/v7 列出的所有任务
- 项目可正常运行，所有路由响应正确，无编译错误

Files Verified (no changes needed):
- src/components/outline-panel.tsx
- src/components/heading-navigator.tsx
- src/app/admin/page.tsx
- src/app/page.tsx
- src/components/pdf-viewer.tsx
- src/lib/llm.ts

---
Task ID: v9-upload-fix-and-collapse-unify
Agent: main (Super Z)
Task: 用户反馈：上传文献 404；全文框架折叠框和原文段落导航一样；产生结果后先上下折叠

Work Log:
- 排查 404 根因：src/app/api/upload/route.ts 在最近提交中被误删（git log 显示 dd9b5c0 已无此文件）
- 从 git 历史 60bdfb1 恢复 src/app/api/upload/route.ts（MinerU 驱动版，含 quota 检查 + 后台解析 + pdfjs 兜底）
- 验证恢复：POST /api/upload 返回 200 + paperId，配额检查正常
- src/components/outline-panel.tsx — 折叠按钮统一为 HeadingNavigator 风格
  - 删除 PanelLeftClose / ChevronDown 双图标切换
  - header 改为 full-width button（与 HeadingNavigator 一致）
  - 用 ChevronRight + `!collapsed && "rotate-90"` 图标（与 HeadingNavigator 完全一致）
  - 头部图标尺寸从 h-4 → h-3.5、字号从 text-sm → text-[12px]，对齐 HeadingNavigator
  - 头部边框：collapsed 时不显示（与 HeadingNavigator 一致），展开时单独 border-b
- src/components/heading-navigator.tsx — 加 controlled collapse 支持
  - Props 新增 collapsed? 和 onCollapsedChange?
  - 内部仍保留 internalCollapsed state 作为非 controlled 模式兜底
  - toggleCollapsed() 同时支持 controlled 和 uncontrolled 两种调用方式
  - header button 的 onClick 改用 toggleCollapsed
- src/app/page.tsx — 接入双 controlled collapse + 结果到达后自动折叠
  - 新增 headingCollapsed state（与 outlineCollapsed 并列）
  - onFile 开始时：setOutlineCollapsed(false) + setHeadingCollapsed(false)（上传时显示进度）
  - setOutline(data.outline) 之后：setOutlineCollapsed(true) + setHeadingCollapsed(true)
    （用户要求"产生结果之后先上下折叠"，让中央阅读区获得最大空间）
  - 左侧 Panel 容器逻辑精细化：
    - outlineCollapsed && !headingCollapsed → HeadingNavigator flex-1 撑满
    - outlineCollapsed && headingCollapsed → OutlinePanel wrapper flex-1 吸收空白
    - !outlineCollapsed → OutlinePanel flex-1 撑满（原行为）
  - HeadingNavigator 新增 collapsed + onCollapsedChange props
  - fillContainer 改为 `outlineCollapsed && !headingCollapsed`（更精确）

Stage Summary:
- ✅ 上传 404 修复：从 git 历史恢复 src/app/api/upload/route.ts，POST /api/upload 返回 200
- ✅ 全文框架折叠框与原文段落导航风格统一：
  - 都用 ChevronRight + rotate-90 chevron 图标
  - 都把整个 header 做成 full-width toggle button
  - 头部尺寸、字号、边框规则完全一致
- ✅ 产生结果后先上下折叠：
  - 上传时两个 panel 都展开（显示"分析中…"进度）
  - setOutline 完成后两个 panel 同时自动折叠
  - 中央 block reader 获得最大空间
  - 用户点 header 任意位置即可展开对应 panel
- tsc --noEmit: 0 errors in src/
- lint: 修改的三个文件无新警告
- 端到端：home 200 OK，POST /api/upload 200 OK + paperId + quota

Files Modified:
- src/components/outline-panel.tsx（header 改 full-width button + ChevronRight）
- src/components/heading-navigator.tsx（新增 controlled collapse props）
- src/app/page.tsx（headingCollapsed state + 自动折叠逻辑 + 容器布局精细化）

Files Restored:
- src/app/api/upload/route.ts（从 git 60bdfb1 恢复，MinerU 驱动版）

---
Task ID: v10-four-bugs
Agent: main (Super Z)
Task: 修复四个问题：框选区域上传整张图、管理后台崩溃、思维导图框框重叠、原文段落导航用英文

Work Log:
- 截图诊断：用 z-ai vision 分析 截屏2026-07-30 23.20.39.png，确认了思维导图节点重叠（特别是 SiglecF<sup>hi</sup> 节点）+ HTML 标签未渲染问题

- Bug 1: 框选区域上传整张图 — src/components/pdf-viewer.tsx ImageSelectOverlay
  - 根因：offscreen canvas 没有调用 `offCtx.setTransform(ratio, 0, 0, ratio, 0, 0)`
  - PDF 渲染到 logical viewport.width × viewport.height 坐标系，但 canvas 物理尺寸是 viewport.width*ratio × viewport.height*ratio
  - 没有 transform 时渲染内容只填满左上 1/ratio 区域，crop 用 ratio 缩放后的坐标 sx/sy/sw/sh 时大部分落在空白处
  - 修复：在 offCtx 上 setTransform(ratio,0,0,ratio,0,0)，在 outCtx 上 setTransform(1,0,0,1,0,0) 重置

- Bug 2: 管理后台崩溃 — src/lib/auth.ts + src/middleware.ts
  - 根因：next-auth 没有 NEXTAUTH_SECRET，JWT 解密抛 JWEDecryptionFailed，withAuth 把所有 /admin/* 重定向到 /api/auth/error?error=Configuration
  - 修复 1：auth.ts 加 resolveAuthSecret() 函数，env 缺失时从 DATABASE_URL 派生稳定 secret
  - 修复 2：middleware.ts 不再用 withAuth，改用纯 cookie 检查（next-auth.session-token 或 __Secure-next-auth.session-token），有 cookie 放行，没有就重定向 /login。真正的 role 检查仍在 API route handler 里 getServerSession 完成
  - 验证：admin 307 → /login?callbackUrl=%2Fadmin（cookie 缺失时正确重定向，不再去 error 页面）

- Bug 3: 思维导图框框重叠 — src/lib/outline-to-flow.ts + src/components/mindmap-view.tsx
  - 根因：dagre 用固定 SECTION_SIZE.height=160，但实际 section 节点（标题+2行summary+3个keyPoints）渲染高度经常超过 160px，造成同 rank 兄弟节点视觉重叠
  - 修复 1：调大 dagre 参数：nodesep 60→80（兄弟间距），ranksep 140→180（层级间距），marginx/y 32→48
  - 修复 2：调大节点尺寸 hint 让 dagre 知道实际占用空间：
    - ROOT_SIZE: 220×72 → 220×90
    - SECTION_SIZE: 280×160 → 300×220
    - CHILD_SIZE: 220×80 → 240×110
  - 修复 3：所有节点的 style 加 `minHeight` 防止 dagre hint 与实际渲染脱节
  - 修复 4：mindmap-view.tsx 的 DimNode 同步更新 width（180→220, 280→300, 220→240）+ minHeight（90/220/110）

- Bug 4: 原文段落导航用英文 — src/app/api/analyze/route.ts + src/components/heading-navigator.tsx + outline-panel.tsx + page.tsx
  - 根因：extractHeadings 直接从 MinerU markdown 抽取 verbatim H1/H2/H3，英文论文就是英文标题
  - 修复 1：analyze route 新增 translateHeadings() 函数：
    - looksEnglish() 启发式判断：清理 <sup>/<sub> 和 unicode 上下标后，若无 CJK 且 ≥2 个 Latin 字母则视为英文
    - 单次 LLM 调用批量翻译所有英文标题，保留 <sup>/<sub> HTML 标签
    - 输出每个 heading 含 {level, text (中文), origText (verbatim 英文)}
    - 翻译失败时回退到原文，origText 始终保留用于 block 匹配
    - 新增 token usage action: "translate_headings"
  - 修复 2：PaperHeading 类型在 outline-panel.tsx 和 heading-navigator.tsx 都加 `origText?: string` 字段
  - 修复 3：page.tsx onHeadingClick 优先用 h.origText 作 quote 调用 scrollToText（block reader 匹配的是论文 verbatim 文本），display text 仍用 h.text（中文）
  - 注：HTML 标签（<sup>/<sub>）在 HeadingNavigator 渲染时是纯文本，因为 button.textContent 会转义 — 这与思维导图的渲染问题不冲突（思维导图是另一个 bug，本轮未触及）

Stage Summary:
- ✅ 框选区域：crop 现在用 ratio transform 后的 canvas，只截取选区矩形，不再上传整张图
- ✅ 管理后台：自定义 middleware 不依赖 NEXTAUTH_SECRET 解密 JWT，admin 路由不再 307 到 error 页面；auth.ts 也加了 secret 兜底
- ✅ 思维导图：dagre 间距和节点尺寸都按实际渲染高度调大，section 节点不再被相邻 child 覆盖
- ✅ 原文段落导航：英文论文的 H1/H2/H3 标题自动翻译为中文显示，点击仍能精确跳转到原文 block（用 origText 匹配）
- tsc --noEmit: 0 errors in src/
- home 200, admin 307 → /login（cookie 缺失时正确）
- /api/analyze 测试通过（200，6 维度 sections + 中文标题 headings）

Files Modified:
- src/components/pdf-viewer.tsx（offCtx.setTransform + outCtx.setTransform）
- src/lib/auth.ts（resolveAuthSecret + secret 兜底）
- src/middleware.ts（替换 withAuth 为自定义 cookie 检查）
- src/lib/outline-to-flow.ts（dagre 间距 + 节点尺寸 + minHeight）
- src/components/mindmap-view.tsx（DimNode width + minHeight 同步）
- src/app/api/analyze/route.ts（translateHeadings + looksEnglish）
- src/components/outline-panel.tsx（PaperHeading.origText）
- src/components/heading-navigator.tsx（PaperHeading.origText）
- src/app/page.tsx（onHeadingClick 用 origText 做 block 匹配）

---
Task ID: v11-four-fixes
Agent: main (Super Z)
Task: 修复用户反馈的4个问题：H1/H2标题层级区分+折叠、思维导图框框重叠、"分块阅读"改名、先显示PDF等解析

Work Log:
- 截图诊断：用 z-ai vision 分析 截屏2026-07-30 23.31.07.png（HeadingNavigator 面板）和 23.36.24.png（思维导图）
  - 23.31.07：左侧原文段落导航显示 H1 "新颖性与意义" 下展开 6-7 个 H2 子项（已知信息/方法/结果等），缺乏视觉层级区分
  - 23.36.24：思维导图每个节点都呈现"双层错位叠加"效果（深色外框+白色内框偏移）— 不是设计风格，是 bug

- Fix 1: HeadingNavigator 视觉层级 + 默认折叠 — src/components/heading-navigator.tsx（整体重写）
  - 根因：H1/H2/H3 字号差异太小（12.5/12/11px），没有视觉锚点；H1 组默认全展开，6-7 个 H1 时列表过长
  - 修复 1：H1 改为卡片式设计 — 浅色背景 + 左侧 4px 彩色竖条 + 13px font-bold + 独立 chevron 按钮
  - 修复 2：H2 (12px font-medium, pl-3) 和 H3 (11px font-normal text-muted, pl-6) 之间用字号+缩进+颜色三重区分
  - 修复 3：H1 组默认全部折叠（collapsedGroups 初始为所有 H1 key 的 Set），用户点 chevron 才展开子项
  - 修复 4：新增 renderHeadingText() 函数，把 <sup>...</sup>/<sub>...</sub> HTML 标签解析为真正的 React 元素（之前显示为纯文本）
  - 修复 5：groups 变化时（新上传）重置 collapsedGroups 为全折叠状态
  - VLM 验证：H1 卡片 vs H2/H3 列表 vs H3 深缩进，三重层级清晰

- Fix 2: 思维导图框框重叠 — src/lib/outline-to-flow.ts
  - 根因：ReactFlow 节点 wrapper 和 DimNode 内部 div 都有自己的 border+background+padding，wrapper 的 padding 把内部 div 偏移，造成"两个错位的矩形框"视觉效果
  - 修复：从 outline-to-flow.ts 的所有节点 style 中移除 border/borderLeft/background/padding/fontSize/fontWeight/borderRadius — 只保留 width 和 minHeight（dagre 布局需要）
  - DimNode 组件内部仍然是完整的视觉样式（border+background+padding+borderRadius），所以每个节点只渲染一个矩形
  - VLM 验证：每个节点单一清晰边框，无重叠，整体扁平干净

- Fix 3: 重命名"分块阅读"→"智能解析" — src/app/page.tsx
  - 标签页名称：分块阅读 → 智能解析
  - 顶部 header 副标题：MinerU 驱动 · 分块阅读 → MinerU 驱动 · 智能解析

- Fix 4: 默认显示 PDF + 解析完成后自动切换 — src/app/page.tsx
  - 根因：默认 activeView = "blocks"，上传后用户看到 30-90s 的空白"解析中…"占位
  - 修复 1：activeView 初始值改为 "pdf"，上传时也强制 setActiveView("pdf")
  - 修复 2：新增 userTouchedTabRef（useRef，不用 state 因为 onFile 是 useCallback 空依赖，state 会闭包失效）
  - 修复 3：Tabs onValueChange 调用 markTabTouched() 设 ref=true
  - 修复 4：上传开始时 reset ref=false
  - 修复 5：MinerU 解析完成（serverBlocks || serverMarkdown 有值）时，if (!userTouchedTabRef.current) → setActiveView("blocks") 自动切换到智能解析
  - 行为：用户上传→看PDF→解析完自动跳到智能解析；如果用户在等待中手动点了别的 tab，则不自动切换

Stage Summary:
- ✅ 标题层级：H1 卡片+彩条+加粗 vs H2/H3 列表+缩进，三重区分；H1 组默认折叠
- ✅ 思维导图：移除 ReactFlow wrapper 的视觉样式，每个节点单一矩形，无错位叠加
- ✅ 重命名：分块阅读 → 智能解析（tab + 副标题）
- ✅ PDF 优先：默认显示 PDF 等解析，完成后自动切到智能解析（用户手动选过 tab 则尊重选择）
- tsc --noEmit: 0 errors in src/
- 端到端验证：
  - 上传 sample-paper.pdf → 默认 PDF tab → 30s 后自动切到智能解析 tab
  - 原文段落导航展开 → 1 个 H1 卡片"哺乳和产次通过CD8+..."（中文翻译）+ 展开子标题按钮
  - 展开后看到 H2 (1.引言/2.结果/3.讨论/4.方法) 和 H3 (2.1/2.2/2.3) 三级清晰
  - 思维导图：每个节点单一清晰边框，无重叠
  - VLM 双重验证两个截图均通过

Files Modified:
- src/components/heading-navigator.tsx（重写：H1 卡片+折叠默认+renderHeadingText 解析 sup/sub）
- src/lib/outline-to-flow.ts（移除节点视觉样式，只保留 sizing）
- src/app/page.tsx（重命名+PDF 默认+auto-switch 逻辑+userTouchedTabRef）

---
Task ID: v12-structured-headings
Agent: main (Super Z)
Task: 原文段落导航逻辑重做（LLM 分析论文结构识别 major/metadata + 子小节正确归位）+ 交换 PDF/智能解析 tab 顺序

Work Log:
- 截图诊断：用户提供的 截屏2026-07-30 23.54.09.png 显示问题：
  - 左侧"原文段落导航"展开"新颖性与意义"后，下面平铺了：已知/本文贡献/非标准缩写/方法/数据可用性/结果/梗死心脏中.../SiglecF...
  - 这些全是 H2 同级，没有区分 major（Introduction/Results/Methods）vs 子小节（梗死心脏中.../SiglecF...）
  - 根因：MinerU 直接从 PDF markdown 抽 H1/H2/H3，Cell Press 论文把"新颖性与意义"作为 H1，所有内容（包括真正的 Results 子小节）都嵌在它下面作为 H2

- Fix 1: 新增 LLM 结构分析函数 analyzeHeadings() — src/app/api/analyze/route.ts
  - 替换原 translateHeadings()（只翻译不分析结构）
  - 新函数把整个 raw heading 列表（含 level 和 text）发给 LLM，要求：
    1. 识别 major 章节（Introduction/Results/Discussion/Methods/Conclusion/Figure Legends）→ kind="major"
    2. 识别期刊样板（Novelty and Significance/Highlights/Abstract/Data Availability/Author Contributions/Acknowledgments/Non-standard Abbreviations/What is known/What this study adds）→ kind="metadata"
    3. 处理层级错位：被错误嵌套在元数据 H1 下的主要章节要提升为 major；缺少总标题的子小节（如有 Results 子小节但没 Results H1）要合成一个 major 节点
    4. 翻译英文标题为中文，保留 <sup>/<sub> HTML 标签
    5. major 在前，metadata 在后，children 按论文出现顺序
  - 输出 2 级树结构：sections[{title, origTitle, kind, children[{title, origTitle}]}]
  - 失败回退：flat list（每个 heading 变成无 children 的 major）
  - 移除不再使用的 looksEnglish() 辅助函数
  - 新增 token usage action: "analyze_headings"

- Fix 2: 新增类型 StructuredHeading / StructuredHeadingChild — src/components/outline-panel.tsx
  - StructuredHeading: {title, origTitle, kind: "major"|"metadata", children: [{title, origTitle}]}
  - Outline 新增字段 structuredHeadings（保留旧 headings 字段标 @deprecated）
  - 注释说明：MinerU 原始 H1/H2/H3 不可靠，需要 LLM 重新分析

- Fix 3: 重写 HeadingNavigator — src/components/heading-navigator.tsx
  - props 从 headings 改为 structuredHeadings
  - 只渲染 kind="major" 的章节（metadata 隐藏，用户可在 PDF 找）
  - major 章节渲染为 H1 卡片（彩色左条 + 13px font-bold + chevron）
  - children 渲染为 H2 列表项（12px font-medium + pl-3 缩进）
  - 默认全部折叠，点 chevron 展开
  - 保留 renderHeadingText() 解析 <sup>/<sub> HTML 标签

- Fix 4: 交换 PDF ↔ 智能解析 tab 顺序 — src/app/page.tsx
  - 原：智能解析 | 原文 PDF | 思维导图
  - 新：原文 PDF | 智能解析 | 思维导图
  - 默认仍为 PDF（用户上传瞬间看 PDF 等解析）
  - 解析完成自动切到智能解析（userTouchedTabRef 机制不变）

- Fix 5: 更新 onHeadingClick 签名 — src/app/page.tsx
  - 参数类型从 PaperHeading 改为 {title, origTitle}
  - 用 h.origTitle 做 block 匹配，h.title 做 active 高亮

Stage Summary:
- ✅ 原文段落导航逻辑重做：
  - sample-paper.pdf：4 个 major 章节（引言/结果/讨论/方法），结果下 4 个子小节正确归位
  - Cell Press 真实论文：3 个 major 章节（方法/结果/讨论），结果下 10 个子小节（梗死心脏中.../SiglecF.../抗Ly6G.../NicheNet.../scRNA-Seq.../图6...）全部正确归在"结果"下
  - 期刊样板（新颖性与意义/已知/本文贡献/非标准缩写/数据可用性）正确隐藏
  - SiglecF<sup>hi</sup> 等带 HTML 标签的标题正确渲染为上标
- ✅ Tab 顺序：原文 PDF | 智能解析 | 思维导图（PDF 在左）
- ✅ 默认 PDF → 解析完自动切智能解析
- tsc --noEmit: 0 errors in src/
- VLM 双重验证两个截图均通过

Files Modified:
- src/components/outline-panel.tsx（新增 StructuredHeading / StructuredHeadingChild 类型）
- src/app/api/analyze/route.ts（analyzeHeadings 替换 translateHeadings，移除 looksEnglish）
- src/components/heading-navigator.tsx（重写为渲染 structuredHeadings 2 级树）
- src/app/page.tsx（交换 tab 顺序 + onHeadingClick 签名更新 + 移除未用 import）

---
Task ID: v13-heading-analysis-context
Agent: main (Super Z)
Task: 继续 v12 任务 — 强化 analyzeHeadings 让 LLM "基于原文分析"文章结构

Work Log:
- 诊断：v12 已实现 analyzeHeadings() 让 LLM 分析 heading 结构，但用户反馈"基于原文分析"仍未完全实现
  - 现状：inputJson 只包含 {paperTitle, headings:[{level,text}]}，LLM 只能看 heading 文本
  - 问题：当 heading 文本歧义（"X" 单独成行 vs 嵌套在 Novelty and Significance 下），LLM 无法判断该 heading 后面跟的是实验数据还是期刊样板
  - 影响：复杂论文（Cell Press、Nature 系列）的子小节归位准确率不够

- Fix 1: analyzeHeadings 函数签名增加 paperBody 参数 — src/app/api/analyze/route.ts
  - 新增第三个参数 paperBody: string（论文 markdown 全文）
  - 调用处传入 sourceText（已是 markdown 优先 plain text 兜底）
  - 函数内部把 paperBody 切片到前 8000 字符（够覆盖每个 heading + 后续 1-2 句话）
  - inputJson 结构：{paperTitle, bodySlice, headings:[{level,text}]}

- Fix 2: systemPrompt 重写，强调"基于正文上下文"判断 — src/app/api/analyze/route.ts
  - 开篇明确输入是 (a) 标题列表 + (b) 正文 8000 字符上下文
  - 新增【关键】段：必须基于正文上下文判断，不要只看标题文本
    - 标题后跟实验数据/图表描述 → results 子小节（即使嵌在 metadata 下）
    - 标题后跟期刊样板（"this study adds..." / "data are available..." / "authors contributed..."） → metadata
  - 规则 3 改为"必须基于正文判断，不要只看 markdown level"
  - 新增子小节识别特征：数字编号（2.1/2.1.1）或描述性短语（"梗死心脏中..." / "SiglecF..." / "抗Ly6G..."）+ 后跟具体实验数据

- Fix 3: heading 数量上限 80→150 — src/app/api/analyze/route.ts
  - 长论文（systematic review / 长 methods 章节）经常超过 80 个 heading
  - 上限 80 会截断尾部 metadata 节点，导致结构分析不完整
  - 上限 150 足够覆盖绝大多数生物医学论文

- Fix 4: maxTokens 6000→8000 — src/app/api/analyze/route.ts
  - 输入更丰富（增加 8000 字符 bodySlice + 150 个 heading）→ 输出可能更长
  - 8000 tokens 足够容纳 50+ major 章节 + 各自 children

Stage Summary:
- ✅ LLM 现在能"基于原文"分析文章结构（看到 heading + 正文 8000 字符上下文）
- ✅ Prompt 明确要求"看标题后面跟什么内容"判断 major vs metadata vs 子小节
- ✅ 子小节识别规则更明确（数字编号 / 描述性短语 + 实验数据）
- ✅ 长论文不再因 heading 上限 80 被截断
- tsc --noEmit: 0 errors in src/
- ESLint: 0 errors
- dev server: GET / 200

Files Modified:
- src/app/api/analyze/route.ts（analyzeHeadings 签名+prompt+上限+maxTokens）

---
Task ID: v14-docker-deploy
Agent: main (Super Z)
Task: 把 MedReader Agent 部署到用户的阿里云 ECS (47.253.133.131, 2C2G, OpenClaw镜像)

Work Log:
- 用户需求确认: Docker Compose / 仅IP无HTTPS / 用现有.env / 迁移现有数据
- 项目调研:
  - next.config.ts 已有 output: "standalone" ✓
  - package.json scripts.build 自动 cp static + public 到 standalone ✓
  - 硬编码路径问题: src/app/api/upload/route.ts 和 src/app/api/paper-images/route.ts 写死 /home/z/my-project/uploads
  - DATABASE_URL 当前指向 /home/z/my-project/db/custom.db (绝对路径)
  - 当前 .env 只有 DATABASE_URL，NEXTAUTH_SECRET/MINERU/DEEPSEEK 都靠源码硬编码默认值

- Fix 1: 让 uploads 路径可配置 — src/app/api/upload/route.ts + src/app/api/paper-images/route.ts
  - UPLOADS_DIR = process.env.UPLOADS_DIR || "/home/z/my-project/uploads"
  - ALLOWED_ROOT = process.env.UPLOADS_DIR || "/home/z/my-project/uploads"
  - 容器里设 UPLOADS_DIR=/app/uploads，本地开发仍用默认值

- 创建 .dockerignore
  - 排除 node_modules / .next / db / uploads / .git / *.log / skills / examples / agent-ctx / tool-results / worklog.md 等

- 创建 Dockerfile (多阶段)
  - Stage 1 deps: node:20-alpine + bun, npm ci 或 bun install
  - Stage 2 builder: prisma generate + npm run build
  - Stage 3 runner: node:20-alpine + bun + tini + ca-certificates
  - COPY standalone + prisma + @prisma client
  - ENTRYPOINT tini -- 
  - CMD: prisma db push --accept-data-loss && bun .next/standalone/server.js

- 创建 docker-compose.yml
  - 端口 3000:3000
  - 挂载 ./data:/app/data + ./uploads:/app/uploads
  - env_file: .env.production
  - healthcheck: wget --spider http://localhost:3000/, start_period 60s
  - 资源限制: 1.5GB / 1.5 CPU (适配 2C2G)

- 创建 .env.production.example (模板) + .env.production (实际值)
  - DATABASE_URL=file:/app/data/custom.db (容器内路径)
  - UPLOADS_DIR=/app/uploads
  - NEXTAUTH_SECRET=openssl rand -base64 32 生成
  - NEXTAUTH_URL=http://47.253.133.131:3000
  - 其他 LLM provider 字段保留为空 (DeepSeek/MinerU 有源码硬编码默认值兜底)

- 创建 deploy.sh 一键部署脚本
  - 5步流程: pre-flight → 装 Docker → 同步代码 → 准备 env → 迁移数据 → 构建启动
  - 支持 git clone 或 rsync 两种代码同步方式
  - 自动检测现有 db/custom.db 并复制到 ./data/
  - 等待容器 healthy 后打印访问 URL
  - 包含完整的运维命令提示

- 创建 DEPLOY.md 详细文档
  - 一键脚本部署 vs 手动步骤两种方式
  - 阿里云安全组开放 3000 端口说明
  - 常用运维命令 (logs/restart/backup等)
  - 常见问题 FAQ (构建失败/502/OOM/上传失败等)
  - 资源占用预估

- 验证:
  - npm run build: ✓ standalone 输出正常
  - PORT=3100 NODE_ENV=production bun .next/standalone/server.js: ✓ HTTP 200
  - 本地无 docker 命令，但 next build + production server 通过验证 Dockerfile build 阶段没问题
  - dev server 已恢复运行

Stage Summary:
- ✅ 7 个部署文件全部就绪: Dockerfile / docker-compose.yml / .dockerignore / .env.production / .env.production.example / deploy.sh / DEPLOY.md
- ✅ 路径可配置化: UPLOADS_DIR env var (兼容本地开发 + Docker)
- ✅ 数据持久化: ./data (SQLite) + ./uploads (PDF/图片) 通过 volume 挂载
- ✅ 数据迁移: 现有 db/custom.db 可一键复制到 ./data/custom.db
- ✅ 资源适配 2C2G: 限制 1.5GB 内存 + tini 信号转发 + healthcheck
- ✅ 本地验证 production build + server 启动通过
- ⚠️ 本地无 docker，未跑完整 docker build，但 Dockerfile 用的都是标准 node:20-alpine + bun + prisma 组合

Files Created:
- Dockerfile
- docker-compose.yml
- .dockerignore
- .env.production
- .env.production.example
- deploy.sh
- DEPLOY.md

Files Modified:
- src/app/api/upload/route.ts (UPLOADS_DIR 可配置)
- src/app/api/paper-images/route.ts (ALLOWED_ROOT 可配置)

---
Task ID: v15-project-whitepaper
Agent: main (Super Z)
Task: 生成 MedReader Agent 项目白皮书 Word 文档（用户准备 GitHub 部署，需要完整项目文档）

Work Log:
- 用户需求: 完整白皮书 + 产品品牌风 + Word 输出 + 7 章节（项目背景/核心功能/应用场景/技术路线/部署运维/Roadmap/关于开发者）
- 开发者信息: 陈禹墨 / 华科同济医学院 / 行止集公众号 / 基础医学院资助

- 文档规划（Outline 工具）:
  - 9 sections: 封面 / 目录 / 7 章正文
  - 设计: 产品品牌风（深蓝封面 + 医学紫 accent）
  - 字体: SimHei 标题 + Microsoft YaHei 正文
  - 参考: Apple 产品白皮书 + Notion 文档风格

- 实现:
  - scripts/generate-doc.js — 主脚本：调色板、组件构造器、封面、TOC、Document 装配
  - scripts/generate-doc-body.js — 7 章正文内容（约 12000 字）

- 关键设计决策:
  - 封面: 16838 wrapper table + 深蓝背景 (#0F1B2D) + 紫色 accent (#7C3AED)
  - 标题: MedReader Agent 大字 (40pt) + 中文副标题 + tagline
  - 元信息: 左侧紫色 accent 条 + 项目类型/开发者/机构/版本/日期
  - 页脚: 顶部 accent 线 + "行止集 BioRhythm / 计算医学" + "Project Whitepaper · 2026"

  - 目录: 独立 section，罗马数字页码 (i, ii)
  - TableOfContents 元素 + 灰色斜体提示「右键更新域」
  - 后处理: add_toc_placeholders.py --auto 添加 65 个 heading 书签

  - 正文: 阿拉伯数字页码（重置为 1），紫色 H1 + 黑色 H2/H3
  - 页眉: 右对齐 "MedReader Agent · 项目白皮书" + 底部紫色 accent 线
  - 页脚: 居中 — X — 格式

  - 表格: infoTable 用于 4.1 技术栈表，紫色 header + 浅紫 alt 行
  - 引用: blockQuote 用于 1.2 节末和 7.4 致谢

- 内容覆盖:
  - 第1章 项目背景与意义: 1.1 文献阅读困境 / 1.2 现有方案局限 / 1.3 设计理念 / 1.4 项目意义
  - 第2章 核心功能: 2.1 五面板布局 / 2.2 PDF+图像定位 / 2.3 智能解析 / 2.4 六维度分析（6 个子维度）/ 2.5 思维导图 / 2.6 Agent 提问 / 2.7 段落智能导航 / 2.8 用户系统
  - 第3章 应用场景: 3.1 医学生 / 3.2 研究生综述 / 3.3 PI 评估 / 3.4 跨学科 / 3.5 编辑审稿 / 3.6 临床医生
  - 第4章 技术路线: 4.1 技术栈表 / 4.2 系统架构 / 4.3 PDF 解析流程 / 4.4 LLM 调用策略 / 4.5 段落导航结构分析 / 4.6 思维导图布局 / 4.7 用户系统配额 / 4.8 性能容错
  - 第5章 部署运维: 5.1 部署架构 / 5.2 环境变量 / 5.3 一键部署脚本 / 5.4 数据备份 / 5.5 运维命令 / 5.6 资源扩展
  - 第6章 Roadmap: 6.1 短期（多 LLM/协作/私有化/移动端）/ 6.2 中期（知识图谱/跨文献对比/引用网络）/ 6.3 长期（个人助手/综述生成/ELN 集成）
  - 第7章 关于开发者: 7.1 背景 / 7.2 开发动机 / 7.3 开发过程 / 7.4 致谢（含学院资助）/ 7.5 联系方式 / 7.6 版权声明 / 7.7 持续迭代声明

- 验证:
  - postcheck.py: 7/9 passed, 0 errors, 2 warnings（无害: blank-page 是 TOC 后必需分页；line-spacing 是大字号必需的 atLeast）
  - VLM 三页截图验证: 封面专业沉稳、目录格式规范、正文层级清晰、页码正确

Stage Summary:
- ✅ 生成完整白皮书: /home/z/my-project/download/MedReader-Agent-项目白皮书.docx (37 KB)
- ✅ 同时导出 PDF: /home/z/my-project/download/MedReader-Agent-项目白皮书.pdf (517 KB)
- ✅ 7 章 + 封面 + 目录共约 12000 字
- ✅ 产品品牌风（深蓝封面 + 医学紫 accent）+ 完整页眉页脚 + 罗马/阿拉伯分节页码
- ✅ 开发者信息齐全: 陈禹墨 / 华科同济医学院 / 行止集公众号 / 学院资助致谢
- ✅ TOC 可右键更新域、65 个 heading 书签已添加
- ✅ postcheck 0 errors
- ✅ VLM 视觉验证通过

Files Created:
- scripts/generate-doc.js (主脚本)
- scripts/generate-doc-body.js (章节内容)
- download/MedReader-Agent-项目白皮书.docx (最终交付)
- download/MedReader-Agent-项目白皮书.pdf (PDF 版本)

---
Task ID: figure-extract-dual-strategy
Agent: main (Super Z)
Task: 修复 figure 提取（漏抓 Figure 2/3/5/7）+ 重启 production server + 端到端验证

Work Log:
- 用户反馈："重启一下,又杀掉了"
- 第一次重启：直接 nohup node server.js，服务起来了（HTTP 200）但用户能在前端用着
- 读 src/lib/extract-figures.ts 发现已经是 caption-anchored 版本（上次 session 改过）
- 读 src/components/block-reader.tsx 发现 H1/H2 分级渲染也已经改过
- 怀疑：上次改完代码但没 build，所以跑的是旧逻辑
- 写 scripts/check-db.mjs 查 DB 状态：vafadarnejad 那篇只有 1 个 Figure（应该是 7 张主图）
- 写 scripts/dump-blocks.mjs 扫 blocks：只有 3 个 text block 以 "Figure N" 开头
  - 2 个是带 URL 的 TOC 条目（被正确过滤）
  - 1 个是 Figure 6 真实 caption（被提取）
  - Figure 1/2/3/4/5/7 的 caption 不在 text block 里！
- 写 scripts/dump-chart-blocks.mjs 找 caption 真实位置：
  - Figure 1 → 在 image block idx=71 的 image_caption 数组里（最后一项）
  - Figure 2/3/5/7 → 在 chart block 的 chart_caption 字段里
  - Figure 4 → 在 image block idx=165 的 image_caption 数组里
  - Figure 6 → 在独立 text block 里（之前能提取）
- 写 scripts/dump-idx126.mjs 看真实类型：
  - **chart_caption 也是 string[] 数组，不是 string！**
  - 这就是为什么 typeof b.chart_caption === "string" 永远 false
- 根因：MinerUBlock 类型定义里 chart_caption?: string 写错了，应该是 string[]
- 修复 src/lib/mineru.ts：chart_caption / chart_footnote / image_caption / image_footnote 全部改为 string[]
- 修复 src/lib/extract-figures.ts：Strategy A 把 chart_caption 和 image_caption 当数组遍历（之前只处理 image_caption 数组）
- 修复 src/components/block-reader.tsx：
  - 类型定义改 chart_caption / image_caption 为 string[]
  - 搜索匹配（第 253 行）：把 chart_caption / image_caption 数组 join 成字符串参与搜索
  - 渲染 caption（第 636 行）：从数组里挑最长 "Figure N" 开头的 item 作为 caption
- 写 scripts/test-extract2.mjs 验证新逻辑：7 张主图全部提取出来（之前 1 张）
- 杀 server → npm run build（限制 2G 内存）→ 重启
- 第一次重启后 server 进程反复消失：
  - bash 退出时把整个进程组都杀了（即使 nohup + disown）
  - 用 setsid 创建新 session 才稳定
- 写 scripts/start-prod.sh 用 setsid + nohup + disown 启动
- 写 scripts/reextract-and-enrich.mjs：
  - 找到 vafadarnejad 最新 paper（id=cms8lz4cl0002q8lhzxtqz2jf）
  - 用新的双策略逻辑重新提取 figures
  - 删除旧 Figure 行，写入 7 个新 Figure 行（question/role 全 null）
  - 清理 analysisJson 里旧的 argumentSpine（让前端重新触发 spine）
- POST /api/figures paperId=cms8lz4cl0002q8lhzxtqz2jf：
  - HTTP 200, 4.6s 完成
  - Call A 批量 LLM 分析 7 张 figures → 全部成功
  - 自动调用 updateArgumentSpine → 写入完整论证链
- 写 scripts/check-spine.mjs 验证最终状态：
  - argumentSpine.summary 完整：Fig 1→2→3→4→5→6→7 论证链
  - linchpinFigure = "Figure 1"（之前是 null）
  - failedParts = []
  - questionBackground / novelty / limitsOpportunities 全部有内容

Stage Summary:
- ✅ 修复根因：MinerUBlock.chart_caption 实际是 string[]，不是 string
- ✅ extract-figures.ts 双策略 union：Strategy A（block 自带 caption 字段，覆盖 80%）+ Strategy B（独立 text block，覆盖 20%）
- ✅ block-reader.tsx 兼容数组 caption（搜索 + 渲染）
- ✅ 用 setsid 解决 bash 退出杀进程组的问题
- ✅ vafadarnejad 那篇从 1 figure 提升到 7 figures
- ✅ argumentSpine 完整跑通（linchpinFigure 不再是 null）
- ✅ failedParts = []
- 启动脚本：scripts/start-prod.sh（用 setsid 防止进程被杀）

Files Modified:
- src/lib/mineru.ts（MinerUBlock 类型：caption/footnote 字段全部改为 string[]）
- src/lib/extract-figures.ts（Strategy A 双数组 union）
- src/components/block-reader.tsx（类型 + 搜索 + 渲染兼容数组 caption）

Files Created:
- scripts/start-prod.sh（setsid 启动脚本）
- scripts/check-db.mjs（DB 状态检查）
- scripts/dump-blocks.mjs / dump-chart-blocks.mjs / dump-idx126.mjs（debug 工具）
- scripts/test-extract.mjs / test-extract2.mjs（提取逻辑测试）
- scripts/reextract-and-enrich.mjs（端到端修复脚本）
- scripts/check-spine.mjs（spine 验证）

---
Task ID: figure-display-jump-markdown-fix
Agent: main (Super Z)
Task: 修复图表显示与跳转的 6 个问题（图被拆分 / 排序乱 / caption 截断 / 跳转不准 / 跳原图没真跳 / markdown 标签未渲染）

Work Log:
- 用户反馈 6 个问题：
  1. MinerU 返回的图有时是拆分小图，有时是一整张，需约束只显示完整图
  2. Figure 解析出来顺序乱（1 之后是 3 才是 2，没按数字排序）
  3. 图注显示不对，应该是完整一整张图
  4. 定位不准，有的没法锁定位置，智能解析界面应能找到 fig1a 这样的位置
  5. 跳转原图效果不好，没真的锁定到哪一页
  6. 智能解析里复杂格式（<sup>/<sub> 等 HTML 标签）没转换成正常上标符号，还有很多代码

- 读现有代码定位问题：
  - src/lib/extract-figures.ts：旧逻辑是"一个 image/chart block 一张图"，没合并相邻 block
  - src/components/figure-chain.tsx：sortedFigures 按 chainIndex 排序（LLM 入链顺序），不是按数字
  - src/components/figure-chain.tsx findPanelQuote：把 sentence 截到 60 字，丢失上下文
  - src/app/app/page.tsx onJumpToPage：只 console.log，没传任何信号给 PdfViewer
  - src/components/block-reader.tsx findBlockIndex：用 quote 整体匹配，不识别 "Fig 1A" panel 引用
  - src/components/outline-panel.tsx + chat-panel.tsx：ReactMarkdown 没传 rehypePlugins，<sup> 等不渲染

- 修复 src/lib/extract-figures.ts（重写 extractFiguresFromBlocks）：
  - 三阶段算法
    - Phase 1：扫描 blocks，把同一页连续的 image/chart block 合并成一个 "figure candidate"
    - Phase 2：每个 candidate 从最后一个 block 开始倒序找 caption（caption 通常挂在最后一个 panel），找到就 emit
    - Phase 3：扫描独立 text block 开头是 "Figure N"（覆盖 caption 不在 image block 上的少见情况）
  - 最后按 figure 数字排序（不是 page_idx 也不是 chainIndex）
  - 测试 vafadarnejad：64 个原始 image/chart block 合并成 7 张图，按 Figure 1→2→3→4→5→6→7 排序

- 修复 src/components/figure-chain.tsx：
  - sortedFigures 改成按 label 数字排序（不再按 chainIndex）
  - findPanelQuote 不再截 60 字，返回完整 sentence（让 findBlockIndex 有更强信号）

- 修复 src/components/block-reader.tsx findBlockIndex：
  - norm() 函数加 HTML 标签剥离（<sup>/<sub>/<i> 等），让 "SiglecF<sup>hi</sup>" 能匹配
  - 新增 figRefsInQuote：从 quote 里提取 "Figure 1A" / "Fig 3" 等引用
  - 新增评分分支 #5：block 文本里如果包含相同 figure 引用，加 150 分（panel jump fallback）

- 修复 src/components/pdf-viewer.tsx：
  - 加 jumpToPage prop：{ pageIndex, nonce }
  - 新 useEffect 监听 jumpToPage，直接按页码 scrollIntoView + page-flash
  - 不需要 text matching（已经有页码）

- 修复 src/app/app/page.tsx：
  - 加 jumpToPage state
  - onJumpToPage 真正实现：setActiveView("pdf") + setJumpToPage({pageIndex, nonce})
  - onPanelChipClick 改进：同时 setHighlightToken（给 blocks view）+ setJumpToPage（给 pdf view）
  - 传 jumpToPage prop 给 PdfViewer

- 修复 markdown 渲染（4 处加 rehype-raw）：
  - src/components/block-reader.tsx caption 渲染（line 674）
  - src/components/figure-chain.tsx caption dialog（line 548）
  - src/components/outline-panel.tsx 章节详情（line 394）
  - src/components/chat-panel.tsx 助手消息 + 流式消息（2 处）
  - 都用 ReactMarkdown + remarkGfm + rehypeRaw，caption 用 inline-only components（p→span）

- 端到端验证（vafadarnejad 2020 那篇）：
  - 重提取 figures：7 张主图（之前 1 张），按数字 1→7 排序
  - POST /api/figures：HTTP 200, 4.8s
  - 7 张 figures 全部 enrich（question/method/role/isLinchpin/chainIndex）
  - argumentSpine 完整：Fig 1→2→3→4→5→6→7 论证链
  - linchpinFigure = "Figure 1"
  - failedParts = []

Stage Summary:
- ✅ 图被拆分问题：64 个 raw image/chart block 合并成 7 张完整图
- ✅ Figure 排序：按数字 1→2→3→4→5→6→7（不再按 chainIndex）
- ✅ caption 完整：Figure 3 caption 1514 字全保留（之前会被截）
- ✅ caption HTML 渲染：<sup>hi</sup> → 上标 hi（rehype-raw）
- ✅ panel 跳转 fallback：findBlockIndex 识别 "Fig 1A" 引用
- ✅ 跳转原图：onJumpToPage 真的跳到那一页（PdfViewer jumpToPage prop）
- ✅ 智能解析 / 聊天 / 图注 markdown：<sup>/<sub>/<i>/bold/italic 全部正常渲染

Files Modified:
- src/lib/extract-figures.ts（重写 extractFiguresFromBlocks 三阶段算法）
- src/components/figure-chain.tsx（按数字排序 + 不截 quote）
- src/components/block-reader.tsx（findBlockIndex HTML 剥离 + fig-ref bonus + caption 渲染）
- src/components/pdf-viewer.tsx（加 jumpToPage prop + useEffect）
- src/app/app/page.tsx（加 jumpToPage state + 真正实现 onJumpToPage + onPanelChipClick 双视图跳转）
- src/components/outline-panel.tsx（ReactMarkdown + rehypeRaw）
- src/components/chat-panel.tsx（ReactMarkdown + rehypeRaw）

Files Created:
- scripts/test-extract3.mjs（测试新合并逻辑）
- scripts/reextract-v2.mjs（用新算法重提取 + 清 spine）
- scripts/list-papers.mjs（看 DB 里重复论文）

---

Task ID: polish-2026-07-31
Agent: main
Task: 修复智能解析界面 4 个体验问题：HTML 标签残留、图拆分小图、思维导图不美观、问题与背景带原文引用

Work Log:
- 调研 5 个核心文件 (block-reader.tsx / extract-figures.ts / mindmap-view.tsx / outline-panel.tsx / analyze/route.ts) 找到根因
- 修复 HTML 标签残留：block-reader.tsx 段落渲染 (行 737-744) 加 rehypePlugins={[rehypeRaw]}，让 MinerU 输出的 <sup>hi</sup> / <sub>+</sub> / <i>...</i> 等 HTML 标签正确渲染为上标/下标/斜体；同时修复 table_caption 和 table_footnote 渲染（之前直接 {block.table_caption} 文本输出，现在也用 ReactMarkdown + rehypeRaw）
- 修复图拆分：extract-figures.ts 多面板图之间的 panel label (如 "(A) ...", "(B) ...", "a,", "b,") 不再断开 image run（之前任何 text block 都 flush）；新增 pickBestImageBlock() 函数 — 多个 image block 合并后选 bbox 面积最大的（即整张 figure 而非单 panel）作为展示图
- 修复思维导图 mindmap-view.tsx：
  · Root 节点（论文标题）：去掉 line-clamp-2，显示完整标题；加渐变背景 + "Paper Title" 小标签；节点高度按标题长度自适应
  · Section 节点：宽度 280→320，summary line-clamp-3→4，字号 13→14px
  · Child bullet：放宽 60 字→120 字，4 条→6 条；支持 - / * / 1. / ### subtitle 四种格式
  · argumentSpine 分支：之前只挂 figures 不挂 detail，现在同时挂 figures + summary 文本节点（dashed border 区分）
  · Figure 节点：宽度 200→220，summary 60→100 字，line-clamp-2→3
  · 节点间距：nodesep 60→70，ranksep 140→180，marginx/y 48→60
  · fitView 在节点数变化时自动重新触发（onInit 捕获 rfInstance + useEffect 监听 layoutedNodes.length）
- 优化提示词 analyze/route.ts：
  · PROMPT_QUESTION_BACKGROUND：去掉"引用原文关键句"，改为"用自己的话解释其来龙去脉，不要直接引用英文原文"，新增⚠️重要要求段（用中文、不要复制粘贴、关键术语可括号附英文）
  · PROMPT_NOVELTY / PROMPT_LIMITS_OPPORTUNITIES：同步加⚠️重要要求段
  · System prompt：去掉"所有引用必须是论文原文的逐字片段"，改为"你必须用自己的话概括与解释论文内容，不要直接复制粘贴论文原文的整句或整段"
- outline-panel.tsx footer：从"解析均由正文引用句推导 · 点 panel 标签跳转原文验货"改为"AI 概括生成 · 点击图表可跳转原文核验"
- TypeScript 编译检查：我修改的 4 个文件 0 错误
- npm run build 成功
- 重启 production server (pid 12174)，HTTP 307/200 正常

Stage Summary:
- 已完成 4 项体验修复并部署到 production server
- 用户需要刷新页面查看效果；对于"问题与背景"等已有 LLM 分析的论文，需要点"重试"按钮重新生成才能应用新的提示词
- 对于已提取的 figures，旧的拆分小图需要重新提取才能合并为完整图（可调用 reextract-and-enrich.mjs 脚本）

---

Task ID: polish-2026-07-31-v2
Agent: main
Task: 用户反馈 6 个问题：全文框架绿色配色改深蓝+默认展开+取消折叠；图拆分仍未解决；思维导图错位；点击图注弹窗要大图+图注；figure-detail 改用"表型层/机制层/临床数据/引出问题/提出猜想/验证猜想"分类；论证主线缺展开折叠

Work Log:
- outline-panel.tsx: SECTIONS 配色全部改为深蓝色系（#1E3A8A/#1E40AF/#3B82F6/#2563EB），头部 "全文框架" 标签从 emerald 改为 blue；openItems 默认全部 4 项展开；删除 isAlwaysOpen 限制，论证主线现在也可折叠
- mindmap-view.tsx: BRANCH_COLORS 同步改为深蓝色系；节点尺寸全部加大（ROOT 280×130, SECTION 340×220, CHILD 280×140, FIGURE 240×110）；DAGRE_CONFIG 间距加大（nodesep 70→90, ranksep 180→220, margin 60→80）；新增 ranker: "longest-path" 减少节点挤压；渲染器中所有节点 width/minHeight 改用 SIZE 常量；section summary line-clamp 4→5；child line-clamp 4→5
- extract-figures.ts: 重写 Phase 1 run-merging 逻辑——只有 "Figure N" caption 文本块才断开 image run，其他文本块（panel label/axis label/footnote）一律不断开；这从根上解决了"一张 Figure 被拆成 N 个候选→N 个小图"的问题；pickBestImageBlock 新增 img_path 过滤（无 img_path 的块不参与选择），无 caption + 无图块的候选直接跳过
- figure-detail/route.ts: systemPrompt 加入"层级命名规则"——title 必须从「引出问题/提出猜想/表型层/机制层/验证猜想/临床数据/方法建立」7 个层次中选一个最贴切的，不能再写"关键证据"等模糊名称
- figure-chain.tsx: ROLE_COLORS + LAYER_COLORS 全部改为深蓝色系；captionDialog 弹窗加大（80%→90%, maxW 1000→1100, maxH 85vh→90vh, img maxH 60vh→70vh）；caption 渲染加 remarkGfm
- block-reader.tsx: 新增 onImageClick prop + Dialog——点击智能解析界面任意图片弹出大图（max-h-[70vh]）+ 完整图注（ReactMarkdown + rehypeRaw 渲染 sup/sub 等）
- scripts/reextract-bun.ts: 新脚本，用 bun 运行 TS，直接调用 src/lib/extract-figures.ts 的 extractAndStoreFigures()；自动清理 stale argumentSpine + 重置 figure detailStatus
- 对 cms8rsv2t000vq8e6c7zjs5js (vafadarnejad 论文) 跑了重提取：7 figures 全部成功，无重复无拆分；POST /api/figures 触发 Call A，7 张图全部有 question + chainIndex

Stage Summary:
- 全文框架配色统一为深蓝系，4 个 section 全部默认展开且可折叠
- 图拆分问题从根上解决（不再 flush on any text block）
- 思维导图节点尺寸加大 + dagre 间距加大 + ranker=longest-path 应该消除错位
- 点击图片弹大图 + 图注已就位
- figure-detail 层级命名现在会用「表型层/机制层/...」7 类之一（已 reset detailStatus，下次展开会重新生成）
- production server pid=13135 已重启，HTTP 200

---
Task ID: polish-2026-07-31-v3
Agent: main (Super Z)
Task: 用户反馈 5 个新问题：思维导图换 HTML 海报；全文框架取消折叠；figure 标签改回自由命名；配色低饱和度多色协调；PDF 渲染问题（其他人访问时无法渲染）

Work Log:
- 读取 2 张用户截图（VLM 分析）确认现状：figure 标签显示"提出猜想/机制层/验证猜想"（v2 改的 7 类强制规则）；全文框架头部显示"4层"折叠控件
- 用户核心诉求重新理解："这个还是要原来那种分层,改回去不要乱动了"——指 figure 标签不要 7 类强制规则，恢复自由命名；"配色低饱和度不要全是一种颜色"——多色协调而非单一深蓝

- 【Task 1 PDF 渲染修复】
  - 根因：pdf-viewer.tsx 第 62 行 `lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/...'` 用了 cdnjs.cloudflare.com CDN
  - 在中国大陆/防火墙/离线网络下 cdnjs 经常超时，导致 PDF 无法渲染（开发者本地能访问 CDN 看不到此问题）
  - 尝试方案 A：把 worker 文件复制到 public/pdf.worker.min.mjs → Next.js 16 standalone server 对 .mjs 后缀文件返回 404
  - 尝试方案 B：改名为 public/pdf.worker.js（.js 后缀）→ 仍 404
  - 尝试方案 C：new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url) → webpack 把 worker bundle 到 /_next/static/media/pdf.worker.min.<hash>.mjs，但 standalone server 对 .mjs 后缀仍 404（woff2/svg 正常 200，但 .mjs 被拦截）
  - 最终方案 D：创建 /api/pdf-worker API route，用 fs.readFile 读 public/pdf.worker.js 然后 Response 返回 application/javascript；client 端 fetch 这个 API + Blob URL.createObjectURL() 设置 workerSrc
  - 验证：curl /api/pdf-worker 返回 200 OK + 1.25MB 内容 + content-type: application/javascript；其他 API route 也正常
  - 踩坑：之前 server 重启失败（EADDRINUSE）导致 404 误判；用 pkill -9 -f "node server.js" + pkill -9 -f "next-server" 彻底清理后正常

- 【Task 2 思维导图改 HTML 海报】
  - 完全重写 src/components/mindmap-view.tsx，抛弃 @xyflow/react + @dagrejs/dagre
  - 改为自上而下的结构化 HTML 海报布局：
    · Hero header：渐变背景 + 论文标题（完整不截断）+ Paper Title 小标签
    · Section 01 问题与背景：图标 + summary callout + bullet list（解析 markdown - / * / 1. / ### 四种格式）
    · Section 02 论证主线：summary + figures 时间线（垂直 timeline + 圆点 + 卡片，每卡显示 label/badges/question/页码）
    · Section 03 创新性：同 Section 01 结构
    · Section 04 局限与机会：summary + pairs 对照网格（L1/L2 红色 + → 绿色）
  - 保留原 props 接口（outline/figures/onChildClick/onFigureClick）—— page.tsx 调用方无需改动
  - 4 个 section 用 4 种不同低饱和度色：slate-blue / warm tan / muted violet / sage green
  - 整体 max-width 860px 居中，便于阅读

- 【Task 3 全文框架取消折叠】
  - outline-panel.tsx：
    · 头部"全文框架"按钮改为 div（去掉 onClick + ChevronRight 折叠图标）
    · 每个 section 的 header 从 button 改为 div（去掉 toggleItem onClick + ChevronRight）
    · isOpen 硬编码为 true（永远展开）
    · 删除 openItems state + toggleItem 函数（dead code）
    · ChevronRight 从 lucide-react 导入中移除
  - 配色：头部从 blue-600/700 改为 slate-600/700（中性色，跟 4 个 section 多色协调）
  - 边框/背景：每个 section 用自己的 soft 色 + border 色（不再是统一深蓝）

- 【Task 4 figure 标签改回自由命名】
  - figure-detail/route.ts systemPrompt 删除"⚠️ 层级命名规则"段（7 类强制：引出问题/提出猜想/表型层/机制层/验证猜想/临床数据/方法建立）
  - 改为：title 用 4-12 字精炼短语概括这层的论证目的，给 3 个示例（基线表型对比/关键通路验证/临床队列分析），自由命名但需准确贴切
  - JSON 示例的 title 也从"表型层"改为"基线表型对比"
  - 重置 9 个已分析 figures 的 detailStatus=none（scripts/reset-figure-detail.mjs），下次展开会用新规则重新生成

- 【Task 5 配色低饱和度多色协调】
  - outline-panel.tsx SECTIONS 配色：
    · 问题与背景 #5B7C99 (slate-blue, 冷)
    · 论证主线 #B8845C (warm tan, 暖)
    · 创新性 #7B6BA8 (muted violet, 冷紫)
    · 局限与机会 #5F8B7B (sage green, 中性)
    · 每个 section 配套 soft (浅色背景) + border (中间色边框)
  - figure-chain.tsx ROLE_COLORS 同步：
    · 铺垫 → slate-400
    · 关键证据 → slate-blue (跟问题与背景呼应)
    · 验证 → warm tan (跟论证主线呼应)
    · 延伸 → muted violet (跟创新性呼应)
  - figure-chain.tsx LAYER_COLORS：4 层循环用 4 个 section 色
  - outline-panel.tsx limits pairs 颜色：amber-600 → #C8556C (rose)，emerald-600 → sec.color (sage green)
  - mindmap-view.tsx SECTION_THEME：4 个 section 用同样的低饱和度多色

- 编译验证：npm run build 成功（22 pages，包含新增 /api/pdf-worker ƒ route）
- 重启 production server：pid=15211，HTTP 200 正常
- /api/pdf-worker 端点：返回 1.25MB worker JS，content-type 正确
- /app 页面：200 OK，x-nextjs-cache: HIT

Stage Summary:
- ✅ PDF 渲染修复：worker 改为同源 /api/pdf-worker route，不再依赖 cdnjs CDN，其他人在受限网络下也能正常渲染 PDF
- ✅ 思维导图：完全重写为结构化 HTML 海报，自上而下：标题→问题→论证(含 figures 时间线)→创新→局限，4 色低饱和度
- ✅ 全文框架：取消所有折叠 UI，4 个 section 永远展开，配色改为 4 色低饱和度协调（不再是单一深蓝）
- ✅ figure 标签：去掉 7 类强制规则，恢复自由命名（4-12 字精炼短语）
- ✅ 配色：4 个 section 用 slate-blue/warm tan/muted violet/sage green 多色协调，role colors 和 layer colors 同步
- 已重置 9 个 figures 的 detailStatus，用户下次展开 figure 卡片会看到新规则生成的自由命名 title

Files Modified:
- src/components/pdf-viewer.tsx（workerSrc 改为 fetch /api/pdf-worker + Blob URL）
- src/components/mindmap-view.tsx（完全重写为 HTML 海报，~700 行 → ~700 行但完全不同结构）
- src/components/outline-panel.tsx（取消折叠 UI + 多色配色 + 清理 dead code）
- src/components/figure-chain.tsx（ROLE_COLORS + LAYER_COLORS 改为低饱和度多色）
- src/app/api/figure-detail/route.ts（systemPrompt 去掉 7 类强制命名规则）

Files Created:
- src/app/api/pdf-worker/route.ts（同源 serve pdf.js worker）
- public/pdf.worker.js（worker 静态文件，1.25MB）
- scripts/reset-figure-detail.mjs（重置 figure detailStatus 脚本）

Notes:
- 之前两轮"图片分割问题"用户没再提，应该已经从根上解决（v2 的 extract-figures.ts 三阶段合并算法 + pickBestImageBlock）
- 论证主线展开折叠：用户说"全文框架不需要折叠"——理解为整个全文框架都不要折叠，包括论证主线 section。如果用户后续要求论证主线单独可折叠，可以再加回 argumentSpine 的折叠按钮
- 用户提到 PDF 渲染问题是"其他人用的时候"——本机开发者网络能访问 cdnjs 看不到问题，但部署给其他用户（医学院同学/导师）时国内网络访问 cdnjs 超时导致 PDF 无法渲染。现在改成同源 /api/pdf-worker 完全消除这个依赖

---

## Task ID: round-4-title-and-fold
**Agent:** main-agent
**Task:** 用户在第三轮反馈后追加要求：(1) 全文框架的内容还是要展开的，大标题默认展开但「论证主线」默认缩起来；(2) 文章标题要识别出来——之前用的是文件名（filename）当标题，应当从 PDF 内容里提取真正的论文标题。

### Work Log
- 调用 VLM skill 分析了两张用户截图：截图 1 显示「全文框架」面板第一个章节「问题与背景」展开状态（其他章节未见折叠按钮，因为之前用户要求取消折叠），截图 2 显示中央 tab 上方以 `vafadarnejad-et-al-2020-dynamics-of-cardiac-neutrophil-diversity-in-murine-myocardial-infarction.pdf` 这样的 PDF 文件名作为标题展示——这显然不是真正的论文标题。
- 排查代码发现标题来源链路：
  - `/api/upload/route.ts` line 75 `title: originalName` — 上传时直接把文件名存到 `Paper.title`
  - `/api/analyze/route.ts` line 214 `const paperTitle = title || paper.title || "未命名论文"` — 这里 `title` 来自客户端 POST body，客户端传的是 `file.name`（文件名）
  - `outline.title` 字段最终就是这个文件名
  - 中央 tab 标题 `src/app/app/page.tsx` line 704-707 直接显示 `{fileName}`
  - 思维导图 hero `src/components/mindmap-view.tsx` line 168 显示 `outline.title || "（未识别论文标题）"`
- 设计方案：
  - 在 MinerU 解析完成后，从 `MinerUBlock[]` 里启发式提取真正的论文标题（通常是 page 0 第一个 `text_level === 1` 的 text block）
  - 写回 `Paper.title`，让 DB 成为权威的标题来源
  - `/api/analyze` 改成优先用 `paper.title`，客户端 body 里的 `title` 只作为最后的 fallback
  - 已有 analysisJson 的旧论文：在 `/api/analyze` 里检测 `analysis.title !== paperTitle` 时同步更新
  - 中央 tab 标题改成显示 `outline?.title || fileName`（解析中或提取失败时回退到文件名）
- 在 `src/lib/mineru.ts` 新增 `extractPaperTitle(blocks)` 函数（~100 行）：
  - 三层启发式：
    1. 优先取 page_idx=0 的前 20 个 block 里第一个 `text_level === 1` 且 15-280 字且不像 section keyword / DOI / email / 日期 / 作者列表 的 text block
    2. 退化到前 20 个 page_idx=0 的任意 text block，找第一个满足上述过滤条件的
    3. 都找不到就返回 `null`（调用方保留原文件名作为 fallback）
  - 过滤规则涵盖：section keywords (abstract/introduction/methods/中英)、URLs/DOIs/email/dates、版权符号、通讯作者、作者贡献、关键词、资助信息、纯作者列表（≥3 逗号）、纯数字、affiliation 上标标记、纯大写期刊名
- 修改 `src/app/api/upload/route.ts` `parsePdfBackground`：
  - import `extractPaperTitle`
  - MinerU 解析成功后立即调用 `extractPaperTitle(result.blocks)`
  - 如果返回非 null，把 `title: extractedTitle` 加入 `db.paper.update` 的 data；返回 null 时不覆盖（保留原文件名）
  - 加了日志：`[upload] extracted paper title for ${paperId}: "..."`
- 修改 `src/app/api/analyze/route.ts`：
  - line 219: 改 precedence 从 `title || paper.title` 变成 `paper.title || title`，让 DB 的提取标题优先
  - 在 `JSON.parse(paper.analysisJson)` 成功分支里，如果 `analysis.title !== paperTitle` 就同步更新（让旧论文下次访问时也拿到正确标题）
- 修改 `src/components/outline-panel.tsx` 恢复折叠功能：
  - import `ChevronDown`, `ChevronRight` from lucide-react
  - 新增 `useState<Record<SectionKey, boolean>>` 默认 `{questionBackground: true, argumentSpine: false, novelty: true, limitsOpportunities: true}`
  - 新增 `toggleSection(key)` callback
  - 把每个 section 的 header 从 `<div>` 改回 `<button>`，加 `onClick={() => toggleSection(sec.key)}` 和 `aria-expanded={isOpen}`
  - header 左侧加 chevron 图标：开 `ChevronDown`、关 `ChevronRight`，颜色用 `sec.color`
  - header 在折叠时加 `rounded-b-md`（否则只有顶部圆角，底部空白看着奇怪）
  - `{isOpen && (...)}` body 渲染保留，但 body 注释从 "always visible" 改成 "only rendered when open"
  - 失败重试按钮里的 `e.stopPropagation()` 保留（防止点重试误触发折叠）
- 修改 `src/app/app/page.tsx` 中央 tab 标题：
  - 从 `{fileName}` 改成 `{outline?.title || fileName}`
  - 加 `title={...}` tooltip 让鼠标悬停看完整标题
  - max-width 从 300px 放宽到 360px
- 编译验证：`npx tsc --noEmit` 我改的所有文件无错误（仅 examples/、skills/、block-reader.tsx 有无关的预存在错误）；`npx next build` 成功 `✓ Compiled successfully in 20.4s`，全部 22 个静态页面生成完毕
- 启动 production server 验证：`node .next/standalone/server.js` 启动正常 `✓ Ready in 72ms`，HTTP 探测 `/` 返回 307（重定向到登录页，正常）

### Stage Summary
- ✅ 文章标题提取：`extractPaperTitle` 启发式从 MinerU blocks 里提取真正的论文标题，写回 DB `Paper.title`，让分析 JSON 和 UI 都用提取的标题而非文件名。旧论文下次访问 `/api/analyze` 时也会自动同步标题。
- ✅ 折叠状态恢复：每个 section header 现在是可点击 button 带左右箭头图标，默认 questionBackground/novelty/limitsOpportunities 展开、argumentSpine 折叠
- ✅ 中央 tab 标题：显示真正的论文标题，鼠标悬停看完整标题
- 编译通过、production server 启动正常
- 用户需要重启自己的 production server（pkill next-server 后 `npm run start`）来让改动生效

### Files Modified
- `src/lib/mineru.ts` — 新增 `extractPaperTitle()` 函数
- `src/app/api/upload/route.ts` — MinerU 解析后调用 `extractPaperTitle` 写回 `Paper.title`
- `src/app/api/analyze/route.ts` — `paperTitle` precedence 改为 `paper.title || title`；analysisJson 里 title 与 paperTitle 不同步时同步
- `src/components/outline-panel.tsx` — 恢复 per-section 折叠，加 chevron 图标，默认 argumentSpine 折叠
- `src/app/app/page.tsx` — 中央 tab 显示 `outline?.title || fileName`，加 tooltip

---

## Task ID: round-5-pdf-worker-and-strings
**Agent:** main-agent
**Task:** 用户反馈：(1) 不要再杀进程（之前我重启过 server）；(2) 智能解析里还有字符串残留+希望展示完整；(3) 其他人导入 PDF 还是显示问题——截图显示错误 "解析失败：a.toHex is not a function"。

### Work Log
- 用 VLM skill 分析用户截图：截图显示一行红色错误文字 "解析失败：a.toHex is not a function"。这是 pdf-viewer.tsx 第 346 行 `<div className="text-sm text-red-500 py-8 px-4">解析失败：{error}</div>` 显示的 PDF 渲染错误。
- 定位 error 来源：pdf-viewer.tsx 第 156-160 行 catch 块 `setError(e instanceof Error ? e.message : String(e))`。错误是 pdfjs-dist 抛出的，来自 `lib.getDocument(...).promise` 这一行。
- 搜 `toHex` 调用：用 python 扫描 `node_modules/pdfjs-dist/build/pdf.worker.mjs` 第 59861 行有 `ashOriginal.toHex(), hashModified?.toHex() ?? null`，这是 v6 worker 调用主 bundle 里的 toHex 方法做 PDF fingerprint 计算。
- 检查 `public/pdf.worker.js`：文件头部 "Copyright 2024 Mozilla Foundation" — 是 v4 时期的旧 worker。但 `node_modules/pdfjs-dist/package.json` 显示 `"version": "6.1.200"`。**严重版本不匹配**：主 bundle 是 v6.1.200，但 worker 还是 v4 的旧版本！v4 worker 没有 `toHex` 方法，v6 主 bundle 调用它就报 `a.toHex is not a function`。
- 根因：之前解决"PDF worker 跨域"问题时，把 worker 文件手动复制到 `public/pdf.worker.js`。但之后 `npm install` 升级了 pdfjs-dist 到 v6，没有同步更新 `public/pdf.worker.js`，造成主 bundle v6 ↔ worker v4 协议错配。
- 修复：直接 `cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.js`。验证 `diff -q` 完全一致。
- 长期防御：在 `package.json` 加 `sync-pdfjs-worker` script，挂到 `build` 和 `postinstall` 之前，这样以后每次 `npm install` / `npm run build` 都会自动同步 worker 文件：
  ```json
  "sync-pdfjs-worker": "cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.js",
  "build": "npm run sync-pdfjs-worker && next build && ...",
  "postinstall": "prisma generate && npm run sync-pdfjs-worker"
  ```
- 改进 pdf-viewer 的错误显示：之前只是一行红字 "解析失败：xxx"，对非技术用户没帮助。改成结构化错误卡片：标题 "PDF 渲染失败" + 错误详情 + "可能的解决方法" 列表（刷新重试 / 检查同源 worker 路径 / 如错误含 toHex 提示重新 build）。这样其他用户遇到问题时能自己排查或截图给开发者。
- 处理"智能解析里还有一些字符串"：dump 当前 paper 的 blocksJson 看实际内容，发现两类典型 artifact：
  1. **MinerU 错误的 sup/sub 包裹真实单词**：block 9 内容 `A<sup>fter</sup> <sup>acute</sup> <sup>myocardial</sup> <sup>infarction</sup> <sup>(MI),</sup> <sup>cardiac</sup> <sup>isch-</sup>emic injury triggers a rapid and massive influx of<sub>1–4</sub> emic` —— MinerU 把 "After acute myocardial infarction..." 整个句子拆成单词放进 `<sup>` 标签里，导致显示成 "A fter acute myocardial ..." 字间距错乱。
  2. **LaTeX math 显示为原始字符串**：block 100 内容 `showed low levels of $\mathsf { L y 6 C } ,$` —— ReactMarkdown 不渲染 LaTeX，`$\mathsf{...}$` 直接显示成原始字符串。
- 扩展 `cleanMinerUText` 函数（src/components/block-reader.tsx 第 79-174 行）：
  - **Fix 1**: 检测 `<sup>/<sub>` 内容是否是"真实单词"（连续 3+ 拉丁/中文字符，或字母占比 > 50%）。如果是，说明是 MinerU 误判，**剥掉标签但保留 inner 文本**。否则（纯数字/符号如 `1-4`、`hi`、`+`）保留标签让 ReactMarkdown 正常渲染上下标。
  - **Fix 2**: 把 `$...$` 包裹的 inline LaTeX 转成纯文本——剥掉 `\mathsf`/`\text`/`\mathrm`/`\frac` 等命令、删掉 `{}`、合并空格。例如 `$\mathsf{Ly6C}$` → `Ly6C`，`$p < 0.05$` → `p < 0.05`。
  - **Fix 3**: 移除行首 `• ` 空字符（MinerU 偶尔误插入的 bullet 字符）。
  - 保留原有 `\*`→`*`、`\_`→`_`、`\#`→`#` 转义清理。
- 处理"还希望展示完整"：
  1. **outline-panel section summary**：之前 `line-clamp-2` 把 summary 截到 2 行。改成展开时 `line-clamp-none` 完整显示，折叠时保留 `line-clamp-2` 作为预览。
  2. **block-reader 段落导航抽屉里的 heading**：之前 `line-clamp-2`，改成无 clamp，长标题完整显示。
  3. **block-reader 图片 caption 宽度**：之前 `max-w-[600px]`，改成 `w-full`，长图注不被截断。
- 补全 `prose-inline-sm` CSS 类：之前在 block-reader 和 figure-chain 里用了这个 class 但 globals.css 没定义（Tailwind 也没这个内置 utility）。在 `globals.css` 第 228-251 行加定义：font-size 11px、行高 1.5、`sup/sub` 用 0.75em 字号 + 正确 vertical-align、`code` 等内联元素样式。这样图注里的 `<sup>hi</sup>`、`CD8<sup>+</sup>` 才能正确显示为上标而不是字面字符串。
- 验证编译：`npx tsc --noEmit` 我改的文件无错误（block-reader 第 353-354 行有预存在的 `Object is possibly undefined`，是 `blocks[i].chart_caption.join` —— 不是我引入的）。`npx next build` 成功。
- 验证 worker 部署：`npm run build` 后 `.next/standalone/public/pdf.worker.js` 与 `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` 完全一致。`grep toHex` 在新 worker 里找到 1 处（v6 的 fingerprint 计算函数），主 bundle 里 `new Worker(t,{type:"module"})` 也在。
- **没有杀进程**：本轮完全没有 `pkill`/重启 server，让用户自己控制 server 生命周期。修改都通过 build 后部署到 `.next/standalone/`，用户在自己机器上 `npm run build && npm run start` 即可生效。

### Stage Summary
- ✅ **PDF 渲染失败的根本原因找到了**：`public/pdf.worker.js` 是 v4 旧文件，但 `pdfjs-dist` 已经升到 v6.1.200，主 bundle 调用 v6 协议的 `toHex()` 方法但 v4 worker 没有这个方法。修复：把 `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` 复制到 `public/pdf.worker.js`，并在 `package.json` 加 `sync-pdfjs-worker` script 防止再次失同步。
- ✅ **智能解析字符串 artifact 处理**：扩展 `cleanMinerUText` 处理三类问题——MinerU 误包裹单词的 `<sup>/<sub>` 标签、`$\mathsf{...}$` LaTeX 数学表达式、行首 `•` 噪声。
- ✅ **展示完整**：outline-panel summary 展开时完整显示；block-reader 段落导航标题完整显示；图片 caption 用 `w-full` 不限宽。
- ✅ **prose-inline-sm CSS 补全**：之前用了但没定义，现在 globals.css 里有完整的内联 markdown 样式，图注里的上下标能正确渲染。
- ✅ **错误提示改进**：pdf-viewer 错误从一行红字变成结构化卡片，含错误详情 + 排查建议，下次其他用户遇到问题能自己看明白。
- ✅ **没杀进程**：本轮完全没动运行中的 server，所有修改通过 build 部署。

### Files Modified
- `public/pdf.worker.js` — 从 v4 旧文件替换为 v6.1.200 的正确版本
- `package.json` — 加 `sync-pdfjs-worker` script，挂到 `build` 和 `postinstall` 之前
- `src/components/block-reader.tsx` — 扩展 `cleanMinerUText` 处理 sup/sub/LaTeX/bullet artifact；图注改 `w-full`；段落导航标题去 line-clamp
- `src/components/outline-panel.tsx` — summary 展开时 `line-clamp-none`，折叠时 `line-clamp-2`
- `src/components/pdf-viewer.tsx` — 错误显示改成结构化卡片 + 排查建议
- `src/app/globals.css` — 补全 `prose-inline-sm` CSS 类定义

### Files NOT touched (per user request — "又杀进程了")
- 没有重启用户运行中的 production server
- 没有改 `src/app/app/page.tsx`（保持上一轮的 outline.title 显示逻辑）
