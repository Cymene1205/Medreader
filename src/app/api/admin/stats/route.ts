import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin dashboard statistics.
 *
 * Requires an authenticated session with role === "admin".
 *
 * Returns:
 *  - dailyActive: last 30 days, distinct userIds from UsageEvent per day
 *  - dailyActions: last 30 days, count by action per day (analyze/chat/translate/vision/upload_pdf)
 *  - feedbackSummary: { up, down } total counts
 *  - recentUsers: last 10 users with chatCount and lastActiveAt
 *  - recentChats: last 10 chat logs (question truncated to 80 chars)
 *  - downFeedbacks: all down-vote feedbacks with original Q&A (answer truncated 200 chars + full text)
 *  - totalUsers: total user count
 *  - totalChats: total chat count
 *
 * Notes:
 *  - Prisma stores DateTime as INTEGER (ms since epoch) in SQLite v6+,
 *    so we use `date(createdAt/1000, 'unixepoch')` for date grouping.
 *  - MAX(e.createdAt) returns a BigInt from $queryRaw; we coerce to Number.
 */

type RawRow = Record<string, unknown>;

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "bigint") {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return new Date(n).toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return null;
}

export async function GET() {
  // Auth + role check (the middleware already gates /api/admin/* but we
  // defensively re-check the role here in case middleware is misconfigured).
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  try {
    // --- dailyActive: distinct userIds per day in last 30 days ---
    const dailyActiveRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT date(createdAt/1000, 'unixepoch') AS date,
              COUNT(DISTINCT userId) AS users
         FROM UsageEvent
        WHERE createdAt >= ? AND userId IS NOT NULL
        GROUP BY date(createdAt/1000, 'unixepoch')
        ORDER BY date ASC`,
      cutoff
    );
    const dailyActive = dailyActiveRaw.map((r) => ({
      date: String(r.date),
      users: Number(r.users),
    }));

    // --- dailyActions: count by action per day (last 30 days) ---
    const dailyActionsRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT date(createdAt/1000, 'unixepoch') AS date,
              action,
              COUNT(*) AS count
         FROM UsageEvent
        WHERE createdAt >= ?
        GROUP BY date(createdAt/1000, 'unixepoch'), action
        ORDER BY date ASC`,
      cutoff
    );
    const trackedActions = ["analyze", "chat", "translate", "vision", "upload_pdf"];
    const actionByDate = new Map<string, Record<string, number | string>>();
    for (const r of dailyActionsRaw) {
      const date = String(r.date);
      const action = String(r.action);
      if (!actionByDate.has(date)) {
        const base: Record<string, number | string> = { date };
        for (const a of trackedActions) base[a] = 0;
        actionByDate.set(date, base);
      }
      const entry = actionByDate.get(date)!;
      if (trackedActions.includes(action)) {
        entry[action] = Number(r.count);
      }
    }
    const dailyActions = Array.from(actionByDate.values());

    // --- feedbackSummary ---
    const feedbackRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT type, COUNT(*) AS count FROM Feedback GROUP BY type`
    );
    let up = 0;
    let down = 0;
    for (const r of feedbackRaw) {
      if (r.type === "up") up = Number(r.count);
      else if (r.type === "down") down = Number(r.count);
    }
    const feedbackSummary = { up, down };

    // --- recentUsers: last 10 users with lastActiveAt + chatCount ---
    const recentUsersRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT u.id, u.email, u.name, u.createdAt,
              (SELECT MAX(e.createdAt) FROM UsageEvent e WHERE e.userId = u.id) AS lastActiveAt,
              (SELECT COUNT(*) FROM ChatLog c WHERE c.userId = u.id) AS chatCount
         FROM User u
        ORDER BY u.createdAt DESC
        LIMIT 10`
    );
    const recentUsers = recentUsersRaw.map((r) => ({
      id: String(r.id),
      email: String(r.email),
      name: r.name == null ? null : String(r.name),
      createdAt: toIsoDate(r.createdAt),
      lastActiveAt: toIsoDate(r.lastActiveAt),
      chatCount: Number(r.chatCount),
    }));

    // --- recentChats: last 10 chat logs ---
    const recentChatsRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT c.id, c.question, c.paperTitle, c.createdAt, u.email AS userEmail
         FROM ChatLog c
         LEFT JOIN User u ON c.userId = u.id
        ORDER BY c.createdAt DESC
        LIMIT 10`
    );
    const recentChats = recentChatsRaw.map((r) => ({
      id: String(r.id),
      userEmail: r.userEmail == null ? null : String(r.userEmail),
      question: r.question == null ? "" : String(r.question).slice(0, 80),
      paperTitle: r.paperTitle == null ? null : String(r.paperTitle),
      createdAt: toIsoDate(r.createdAt),
    }));

    // --- downFeedbacks: all down-vote feedbacks, newest first ---
    const downFeedbacksRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT f.id, f.userId, f.reason, f.createdAt, f.chatLogId,
              u.email AS userEmail, c.question, c.answer
         FROM Feedback f
         LEFT JOIN User u ON f.userId = u.id
         LEFT JOIN ChatLog c ON f.chatLogId = c.id
        WHERE f.type = 'down'
        ORDER BY f.createdAt DESC`
    );
    const downFeedbacks = downFeedbacksRaw.map((r) => {
      const fullAnswer = r.answer == null ? "" : String(r.answer);
      return {
        id: String(r.id),
        userEmail: r.userEmail == null ? null : String(r.userEmail),
        question: r.question == null ? "" : String(r.question),
        answer: fullAnswer.slice(0, 200),
        answerFull: fullAnswer,
        reason: r.reason == null ? null : String(r.reason),
        createdAt: toIsoDate(r.createdAt),
        chatLogId: r.chatLogId == null ? null : String(r.chatLogId),
      };
    });

    // --- totals for the top stat cards ---
    const [totalUsers, totalChats] = await Promise.all([
      db.user.count(),
      db.chatLog.count(),
    ]);

    // --- LLM token usage (last 30 days) ---
    // Aggregated by provider+model for the 模型用量 panel.
    const tokenUsageByModelRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT provider,
              model,
              COUNT(*)                              AS calls,
              COALESCE(SUM(promptTokens), 0)        AS promptTokens,
              COALESCE(SUM(completionTokens), 0)    AS completionTokens,
              COALESCE(SUM(totalTokens), 0)         AS totalTokens,
              COALESCE(SUM(costCny), 0)             AS costCny
         FROM TokenUsage
        WHERE createdAt >= ?
        GROUP BY provider, model
        ORDER BY totalTokens DESC`,
      cutoff
    );
    const tokenUsageByModel = tokenUsageByModelRaw.map((r) => ({
      provider: String(r.provider),
      model: String(r.model),
      calls: Number(r.calls),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
      totalTokens: Number(r.totalTokens),
      costCny: Number(r.costCny),
    }));

    // Aggregated by action for the breakdown chart
    const tokenUsageByActionRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT action,
              COUNT(*)                              AS calls,
              COALESCE(SUM(promptTokens), 0)        AS promptTokens,
              COALESCE(SUM(completionTokens), 0)    AS completionTokens,
              COALESCE(SUM(totalTokens), 0)         AS totalTokens,
              COALESCE(SUM(costCny), 0)             AS costCny
         FROM TokenUsage
        WHERE createdAt >= ?
        GROUP BY action
        ORDER BY totalTokens DESC`,
      cutoff
    );
    const tokenUsageByAction = tokenUsageByActionRaw.map((r) => ({
      action: String(r.action),
      calls: Number(r.calls),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
      totalTokens: Number(r.totalTokens),
      costCny: Number(r.costCny),
    }));

    // Daily token usage (last 30 days) for the trend chart
    const tokenUsageDailyRaw = await db.$queryRawUnsafe<RawRow[]>(
      `SELECT date(createdAt/1000, 'unixepoch') AS date,
              COALESCE(SUM(totalTokens), 0)     AS tokens,
              COALESCE(SUM(costCny), 0)         AS costCny
         FROM TokenUsage
        WHERE createdAt >= ?
        GROUP BY date(createdAt/1000, 'unixepoch')
        ORDER BY date ASC`,
      cutoff
    );
    const tokenUsageDaily = tokenUsageDailyRaw.map((r) => ({
      date: String(r.date),
      tokens: Number(r.tokens),
      costCny: Number(r.costCny),
    }));

    // Totals across the 30-day window
    const tokenTotals = tokenUsageByModel.reduce(
      (acc, m) => {
        acc.calls += m.calls;
        acc.promptTokens += m.promptTokens;
        acc.completionTokens += m.completionTokens;
        acc.totalTokens += m.totalTokens;
        acc.costCny += m.costCny;
        return acc;
      },
      {
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costCny: 0,
      }
    );

    return NextResponse.json({
      dailyActive,
      dailyActions,
      feedbackSummary,
      recentUsers,
      recentChats,
      downFeedbacks,
      totalUsers,
      totalChats,
      // NEW — LLM token usage + estimated cost (last 30 days)
      tokenUsage: {
        totals: tokenTotals,
        byModel: tokenUsageByModel,
        byAction: tokenUsageByAction,
        daily: tokenUsageDaily,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/stats] error:", msg);
    return NextResponse.json(
      { error: "failed to compute stats", detail: msg },
      { status: 500 }
    );
  }
}
