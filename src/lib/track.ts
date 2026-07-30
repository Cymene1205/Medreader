import { db } from "@/lib/db";

/**
 * Track a user behavior event. Failures are silently swallowed
 * so they never break the main request flow.
 */
export async function trackEvent(
  userId: string | null | undefined,
  action: string,
  meta?: string
): Promise<void> {
  try {
    await db.usageEvent.create({
      data: {
        userId: userId || null,
        action,
        meta: meta || null,
      },
    });
  } catch (e) {
    // Silent failure
    console.warn("[trackEvent] failed:", e);
  }
}
