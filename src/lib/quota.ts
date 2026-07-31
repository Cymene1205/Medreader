/**
 * Daily quota tracking — protects against MinerU's 1000-page/day cap and
 * provides software-level trial limits for anonymous users.
 */

import { db } from "./db";

// Per-user-per-day caps
export const QUOTA_LIMITS = {
  mineru_parse: 10,    // 10 PDFs/day per user (MinerU's actual page cap is 1000, this is conservative)
  chat: 50,            // 50 chat messages/day per user
  translate: 100,      // 100 translations/day per user
  vision: 20,          // 20 vision Q&As/day per user
} as const;

export type QuotaAction = keyof typeof QUOTA_LIMITS;

function todayStr(): string {
  // UTC+8 (Asia/Shanghai) day boundary
  const now = new Date();
  const shanghai = new Date(now.getTime() + 8 * 3600 * 1000);
  return shanghai.toISOString().slice(0, 10);
}

function ipHash(req?: Request): string | null {
  if (!req) return null;
  const xff = req.headers.get("x-forwarded-for");
  const ua = req.headers.get("user-agent") || "";
  // Simple non-cryptographic hash for grouping anonymous activity.
  const raw = (xff?.split(",")[0] || "anon") + "|" + ua.slice(0, 80);
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  }
  return "ip_" + Math.abs(h).toString(36);
}

/**
 * Whether the given user role should bypass quota enforcement entirely.
 *
 * Admins are exempt from per-day caps on all metered actions so they can
 * keep testing / demoing the product even after a normal user would have
 * been throttled. The MinerU upstream quota is still the real ceiling —
 * we just stop software-blocking admins locally.
 */
export function roleBypassesQuota(role?: string | null): boolean {
  return role === "admin";
}

/**
 * Increment the per-(user,action,day) counter and return whether the
 * caller may proceed (i.e. still under the limit) plus the current
 * count.
 *
 * If the user is anonymous, we key off an IP+UA hash stored in meta.
 *
 * If `userRole` is "admin", the call short-circuits: it returns ok=true
 * WITHOUT touching the counter, so admins never get throttled by their
 * own usage.
 */
export async function checkAndIncrement(
  action: QuotaAction,
  userId: string | null,
  req?: Request,
  userRole?: string | null
): Promise<{ ok: boolean; count: number; limit: number }> {
  // Admin bypass — never increment, never block.
  if (roleBypassesQuota(userRole)) {
    return { ok: true, count: 0, limit: Number.MAX_SAFE_INTEGER };
  }

  const limit = QUOTA_LIMITS[action];
  const day = todayStr();
  const key = userId || ipHash(req) || "anonymous";

  // Upsert counter atomically.
  const row = await db.dailyQuota.upsert({
    where: {
      userId_action_day: { userId: key, action, day },
    },
    create: { userId: key, action, day, count: 1, meta: userId ? null : key },
    update: { count: { increment: 1 } },
  });

  return { ok: row.count <= limit, count: row.count, limit };
}

/**
 * Peek without incrementing — useful for showing remaining quota in the UI.
 *
 * Admins always see "unlimited" remaining so the UI doesn't show a
 * misleading 0/N state.
 */
export async function peekQuota(
  action: QuotaAction,
  userId: string | null,
  req?: Request,
  userRole?: string | null
): Promise<{ count: number; limit: number; remaining: number }> {
  if (roleBypassesQuota(userRole)) {
    return { count: 0, limit: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER };
  }
  const limit = QUOTA_LIMITS[action];
  const day = todayStr();
  const key = userId || ipHash(req) || "anonymous";
  const row = await db.dailyQuota.findUnique({
    where: { userId_action_day: { userId: key, action, day } },
  });
  const count = row?.count ?? 0;
  return { count, limit, remaining: Math.max(0, limit - count) };
}
