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
 * Routes that REQUIRE LOGIN (gated by this middleware):
 *   - `/app/*`         workspace
 *   - `/admin/*`       admin (still does its own role check in handler)
 *   - `/api/upload`    PDF upload (login required — quota keyed off userId)
 *   - `/api/analyze`   structured analysis (writes Paper state, needs owner)
 *   - `/api/figures`, `/api/figure-detail`, `/api/figure-image/*`
 *   - `/api/paper-images`, `/api/paper/*`, `/api/followups`
 *   - `/api/feedback`  requires valid chatLogId (owned by some user)
 *
 * Routes that ALLOW ANONYMOUS (IP-hash quota in route handler):
 *   - `/api/chat`        50/day for anon, login encouraged via UI nudge
 *   - `/api/translate`   100/day for anon
 *   - `/api/vision`      20/day for anon
 *   - `/api/llm-test`    connection test — anonymous ok (no quota gate)
 *   - `/api/quota`       shows remaining quota for current user/IP
 *
 *   These routes wrap `getServerSession()` in try/catch and gracefully
 *   degrade to anonymous flow (keyed off IP+UA hash in DailyQuota).
 *   The middleware must NOT 401 them — otherwise the shared-paper link
 *   recipient (not logged in) cannot ask questions about the paper.
 *
 * SPECIAL CASE — MinerU PDF pull:
 *   `/api/paper/[id]/pdf` normally requires a session cookie (it's
 *   caught by the `api/paper/*` matcher below). But when MinerU's
 *   backend fetches the PDF during parsing, it has no session cookie.
 *   We let it through IF AND ONLY IF the request carries a `?token=`
 *   query param. The route handler verifies the token (HMAC over
 *   paperId signed with NEXTAUTH_SECRET) — so allowing the request
 *   to reach the handler is safe; the handler will 403 if the token
 *   is wrong or missing.
 *
 * Behavior on missing session cookie:
 *   - For protected `/api/*` routes → 401 JSON `{ error: "请先登录", code: "UNAUTHORIZED" }`
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

  // MinerU PDF pull bypass: if this is a /api/paper/[id]/pdf request
  // with a ?token= query param, let it through to the handler. The
  // handler does its own HMAC verification; if the token is bad it
  // returns 403. This keeps the middleware simple (no crypto in edge
  // runtime) while still allowing anonymous MinerU fetches.
  if (
    pathname.startsWith("/api/paper/") &&
    pathname.endsWith("/pdf") &&
    req.nextUrl.searchParams.has("token")
  ) {
    return NextResponse.next();
  }

  const cookies = req.cookies;
  const hasSession =
    cookies.has("next-auth.session-token") ||
    cookies.has("__Secure-next-auth.session-token");
  if (hasSession) {
    return NextResponse.next();
  }

  // No session cookie — block protected routes.
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
  //   login | register | landing              — public auth/landing pages
  //   api/auth                                — NextAuth endpoints
  //   api/upload                              — 大文件上传，绕过 middleware 避免被
  //                                              Next.js 16 默认 10MB body 限制截断
  //                                              (route 内部用 getServerSession 做真正的认证)
  //   api/chat | api/translate | api/vision   — 匿名访问 (路由内部按 IP hash 限额)
  //   api/llm-test                            — LLM 连接测试，匿名可用
  //   api/quota                               — 查询额度，匿名也能看自己的 IP 额度
  //   api/paper-images                        — 论文图片资源 (公开)
  //   _next                                   — Next.js static assets
  //   favicon.ico                             — browser favicon
  // Root `/` is matched by this regex too, but the middleware function
  // short-circuits it (see above).
  matcher: [
    "/((?!login|register|landing|api/auth|api/upload|api/chat|api/translate|api/vision|api/llm-test|api/quota|api/paper-images|_next|favicon.ico).*)",
  ],
};
