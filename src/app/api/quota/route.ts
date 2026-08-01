import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { QUOTA_LIMITS, peekQuota, roleBypassesQuota, type QuotaAction } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Friendly Chinese labels for each metered action — used by the UI.
const ACTION_LABELS: Record<QuotaAction, string> = {
  mineru_parse: "PDF 解析",
  chat: "提问",
  translate: "翻译",
  vision: "图片提问",
};

/**
 * GET /api/quota
 *
 * Returns the current user's per-day quota usage for every metered action.
 *
 * Response shape:
 *   {
 *     isAdmin: boolean,
 *     actions: {
 *       mineru_parse: { label, count, limit, remaining },
 *       chat:         { label, count, limit, remaining },
 *       translate:    { label, count, limit, remaining },
 *       vision:       { label, count, limit, remaining }
 *     }
 *   }
 *
 * - For admins: every action returns limit = Infinity (UI shows "不限量").
 * - For anonymous users: the counter is keyed off an IP+UA hash, so the same
 *   browser sees a consistent number across reloads.
 * - For logged-in regular users: keyed off the user id, resets at 00:00 UTC+8.
 */
export async function GET(req: NextRequest) {
  let userId: string | null = null;
  let userRole: string | null = null;
  try {
    const session = await getServerSession(authOptions);
    userId = (session?.user as any)?.id ?? null;
    userRole = (session?.user as any)?.role ?? null;
  } catch {
    // ignore — anonymous flow
  }

  const isAdmin = roleBypassesQuota(userRole);

  const actions = {} as Record<
    QuotaAction,
    { label: string; count: number; limit: number; remaining: number }
  >;

  // Fetch all four quotas in parallel — peekQuota is read-only.
  const keys = Object.keys(QUOTA_LIMITS) as QuotaAction[];
  const results = await Promise.all(
    keys.map((k) => peekQuota(k, userId, req, userRole))
  );
  keys.forEach((k, i) => {
    const r = results[i];
    // Always report the configured limit (a finite number from QUOTA_LIMITS)
    // so the UI can render "X / 20" even for admins. The top-level `isAdmin`
    // flag tells the client to ALSO show an "不限量" badge and skip the
    // progress bar — JSON can't serialize Infinity, so we don't try.
    actions[k] = {
      label: ACTION_LABELS[k],
      count: r.count,
      limit: QUOTA_LIMITS[k],
      remaining: Math.max(0, r.limit - r.count),
    };
  });

  return NextResponse.json(
    { isAdmin, actions },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
