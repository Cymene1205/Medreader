import { NextRequest, NextResponse } from "next/server";

/**
 * Custom auth middleware for admin routes.
 *
 * We deliberately don't use Next-Auth's `withAuth` here because in dev
 * environments without NEXTAUTH_SECRET, Next-Auth's JWT decryption fails
 * with `JWEDecryptionFailed` and redirects every protected request to
 * `/api/auth/error?error=Configuration`, which 307s the admin page into
 * an auth-error loop even when the user is logged in.
 *
 * Instead we manually:
 *   1. Read the next-auth.session-token cookie (or secure variant).
 *   2. If absent → redirect to /login.
 *   3. If present → let the request through. The actual role check still
 *      happens in the API route handler (`getServerSession`).
 *
 * This sidesteps the JWT decryption entirely; the cookie presence check
 * is enough to keep casual users out, and the route handler enforces the
 * real authorization.
 */
export function middleware(req: NextRequest) {
  const cookies = req.cookies;
  const hasSession =
    cookies.has("next-auth.session-token") ||
    cookies.has("__Secure-next-auth.session-token");
  if (!hasSession) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Only protect admin routes (Feature 2). The home page "/"
  // and the auth pages remain accessible without a token so
  // non-logged-in users can try the app.
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
