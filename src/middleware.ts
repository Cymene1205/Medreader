import { NextRequest, NextResponse } from "next/server";

/**
 * Auth middleware (production hardening — fix #1).
 *
 * Routes that are PUBLIC (no login required):
 *   - `/`              root = landing page (公开门面)
 *   - `/login`         login form
 *   - `/register`      register form
 *   - `/landing`       (reserved; if we move landing here later)
 *   - `/api/auth/*`    NextAuth endpoints (signin, callback, signout, …)
 *   - `/_next/*`       Next.js static assets
 *   - `/favicon.ico`
 *
 * Routes that REQUIRE LOGIN:
 *   - `/app/*`         workspace
 *   - `/admin/*`       admin (still does its own role check in handler)
 *   - any other page not in the public list
 *   - `/api/upload`, `/api/analyze`, `/api/chat`, `/api/translate`,
 *     `/api/vision`, `/api/paper-images`, `/api/followups`, …
 *
 * Behavior on missing session cookie:
 *   - For `/api/*` routes → 401 JSON `{ error: "请先登录", code: "UNAUTHORIZED" }`
 *     (so the frontend can show a friendly "请先登录" toast and redirect
 *     to /login, instead of receiving an HTML redirect body it can't
 *     parse).
 *   - For page routes → 302 redirect to `/login?callbackUrl=<original path>`.
 *
 * We deliberately don't decrypt the JWT here (that would require
 * NEXTAUTH_SECRET to be available to the edge middleware runtime and
 * would fail noisily if misconfigured). Cookie presence is enough for
 * the gate; the route handler still calls `getServerSession()` to do
 * the real authentication.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Root is the public landing page — never protect it.
  if (pathname === "/") {
    return NextResponse.next();
  }

  const cookies = req.cookies;
  const hasSession =
    cookies.has("next-auth.session-token") ||
    cookies.has("__Secure-next-auth.session-token");
  if (hasSession) {
    return NextResponse.next();
  }

  // No session cookie — block.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "请先登录", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match everything EXCEPT:
  //   login | register | landing   — public auth/landing pages
  //   api/auth                     — NextAuth endpoints
  //   _next                        — Next.js static assets
  //   favicon.ico                  — browser favicon
  // Root `/` is matched by this regex too, but the middleware function
  // short-circuits it (see above).
  matcher: ["/((?!login|register|landing|api/auth|_next|favicon.ico).*)"],
};
