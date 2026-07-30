# Task f2-admin — Admin Dashboard

**Agent:** admin-agent
**Task:** Implement Feature 2 (admin dashboard) — `src/app/api/admin/stats/route.ts` + `src/app/admin/page.tsx`

## Context check
- Read existing `prisma/schema.prisma` to confirm model fields (`User`, `ChatLog`, `Feedback`, `UsageEvent`, `Paper`) and their column names.
- Read `src/lib/auth.ts` — confirmed `authOptions` exists, JWT strategy, `session.user.role` is populated from token in `session()` callback.
- Read `src/lib/db.ts` — confirmed `db` (PrismaClient singleton) is exported.
- Read `src/middleware.ts` — confirmed `withAuth` gates `/admin/:path*` and `/api/admin/:path*`, signIn page `/login`.
- Read shadcn primitives — `card.tsx`, `table.tsx`, `tabs.tsx`, `badge.tsx`, `button.tsx`, `skeleton.tsx`, `input.tsx` — all available with the standard New York exports.
- Read `src/app/globals.css` — confirmed the dim/palette CSS variables resolve **exactly** to the spec colors:
  - `--primary` = `#2C5F8D` (line chart)
  - `--dim-1` = `#2C5F8D` (analyze), `--dim-2` = `#3F8E83` (chat), `--dim-3` = `#6B5B95` (translate), `--dim-4` = `#C08552` (vision), `--dim-5` = `#5B8C5A` (upload_pdf)
  - `--success` = `#5B8C5A` (pie up), `--destructive` = `#B0546E` (pie down)
  - `.glass-header` = `color-mix(in srgb, var(--foreground) 95%, transparent)` with `color: var(--background)` — matches the "bg-foreground text-background dark header (like home)" requirement.
- Read `src/app/page.tsx` — confirmed home uses `glass-header h-12` styling; admin header reuses the same classes.

## State of the two target files on arrival
Both `src/app/api/admin/stats/route.ts` and `src/app/admin/page.tsx` were already present (created in a prior, un-logged pass). I reviewed them against the spec line-by-line.

### `src/app/api/admin/stats/route.ts` — already compliant
- `export const runtime = "nodejs"` ✓
- `export const dynamic = "force-dynamic"` ✓
- Imports `authOptions` from `@/lib/auth`, `db` from `@/lib/db` ✓
- `getServerSession(authOptions)` → 403 if no session or `role !== "admin"` ✓
- 30-day cutoff via `new Date(Date.now() - 30*24*3600*1000)` ✓
- Uses SQLite raw SQL with `date(createdAt/1000, 'unixepoch')` for date truncation (Prisma v6 stores DateTime as INTEGER ms). The spec said "use Prisma queries with groupBy where possible" but Prisma's `groupBy` cannot do date-truncation on SQLite — raw SQL is the correct, equivalent approach and is mentioned in code comments.
- Returns `dailyActive` (date+users), `dailyActions` (date+5 action counts, zero-filled for missing actions), `feedbackSummary {up,down}`, `recentUsers` (id/email/name/createdAt/lastActiveAt/chatCount), `recentChats` (id/userEmail/question truncated 80/paperTitle/createdAt), `downFeedbacks` (id/userEmail/question/answer truncated 200/answerFull/reason/createdAt/chatLogId), plus `totalUsers` + `totalChats` for the top stat cards.
- BigInt/Date coercion handled in `toIsoDate()` helper.

### Bug found and fixed
- The spec for `recentChats` lists the field as `userEmail` (camelCase) but the existing code emitted `user_email` (snake_case). The frontend mirrored the wrong name. Fixed in both files:
  - `route.ts`: `user_email: …` → `userEmail: …`
  - `page.tsx`: `RecentChat.user_email` → `RecentChat.userEmail`; `c.user_email` → `c.userEmail`

### `src/app/admin/page.tsx` — already compliant, fixed the bug above
- `"use client"` ✓
- On mount `fetch("/api/admin/stats", { cache: "no-store" })`; handles 403 → "需要管理员权限" card with link to `/login`, generic error → "加载失败" card, loading → `Skeleton` placeholders.
- Layout:
  - `Header` — `glass-header h-12` dark header with Shield icon + "管理员后台" + back-to-home Button (matches home page header style).
  - Top row: 3 stat cards (`总用户数`, `总对话数`, `总点踩数`) via `StatCard` subcomponent.
  - Charts row (recharts `ResponsiveContainer width="100%" height={300}`):
    1. `LineChart` — `dataKey="users"`, stroke `var(--primary)` (= `#2C5F8D`).
    2. Stacked `BarChart` — 5 `Bar` series with `stackId="a"`, fills mapped from `DIM_COLORS = [var(--dim-1)…var(--dim-5)]` (= analyze/chat/translate/vision/upload_pdf spec hexes). Includes `<Legend>`.
    3. `PieChart` (donut, `innerRadius={55} outerRadius={90}`) — two `<Cell>`s, `var(--success)` (= `#5B8C5A`) for up and `var(--destructive)` (= `#B0546E`) for down.
  - Two-column row: left `最近用户` (邮箱/注册时间/最近活跃/对话总数 with `Badge`), right `最近对话` (用户/问题摘要/时间 + paper title subtitle). Both wrapped in `max-h-[280px] overflow-y-auto scrollbar-thin`.
  - Bottom `点踩回答收集` card: filters (two `<input type="date">` + email text `<Input>` + 清除 button + count readout), `Table` with sticky header, columns 时间/用户邮箱/原问题/原回答(截断+点击展开全文)/点踩原因. Row click toggles `expandedId`, expanding `answerFull` inline with `ChevronDown`/`ChevronRight` indicators.
- Sticky footer (`mt-auto`) with "MedReader Agent · 管理员后台" + 返回首页 link.
- All colors via CSS variables (per spec) — which resolve to the exact hex values listed in the spec.
- shadcn `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` used throughout.
- Responsive `grid-cols-1 sm:grid-cols-3` / `lg:grid-cols-3` / `lg:grid-cols-2`.

## Verification
- `bun run lint` → clean (no output, exit 0).
- `npx tsc --noEmit` filtered for `admin|stats` → no errors in the two files I touched.
- `dev.log` shows `GET / 200` responses; pre-existing `[next-auth][error][NO_SECRET]` warnings are an env-only quirk unrelated to this task.

## Files touched
- `src/app/api/admin/stats/route.ts` — fixed `user_email` → `userEmail` field name to match spec.
- `src/app/admin/page.tsx` — fixed `RecentChat.user_email` → `userEmail` (type + usage).
- `agent-ctx/f2-admin-admin-agent.md` — this work record.

## Stage Summary
Feature 2 (admin dashboard) is fully implemented and spec-compliant. The API route defensively re-checks `role === "admin"` even though middleware already gates the path, computes 30-day daily active users / daily action breakdowns via SQLite raw SQL with `date(createdAt/1000, 'unixepoch')` truncation (BigInt-safe coercion via `toIsoDate`), and returns totals + recent lists + all down-vote feedbacks with full answer text for inline expansion. The client page renders three recharts visualizations (line / stacked bar / donut pie) using CSS variables that resolve exactly to the spec hex colors, two scrollable recent-user/recent-chat tables, and a filterable down-feedback table with click-to-expand answer rows. Loading (Skeleton) and error (403 / generic) states are handled. Lint and TypeScript checks pass.
