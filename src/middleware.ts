import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  // Only protect admin routes (Feature 2). The home page "/"
  // and the auth pages remain accessible without a token so
  // non-logged-in users can try the app.
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
