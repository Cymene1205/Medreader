import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

/**
 * Resolve a stable NEXTAUTH_SECRET at runtime.
 *
 * Next-Auth requires a secret to sign/encrypt JWT sessions. In dev / preview
 * environments where the user hasn't set NEXTAUTH_SECRET in .env, the
 * middleware's `withAuth` throws `JWEDecryptionFailed` and redirects every
 * protected route to /api/auth/error?error=Configuration — making the admin
 * page unreachable even when logged in.
 *
 * We fall back to a deterministic dev secret derived from the database path
 * so the JWT remains stable across server restarts within the same project.
 * (Production should always set NEXTAUTH_SECRET explicitly.)
 */
function resolveAuthSecret(): string {
  if (process.env.NEXTAUTH_SECRET && process.env.NEXTAUTH_SECRET.length > 0) {
    return process.env.NEXTAUTH_SECRET;
  }
  // Derive a stable per-project dev secret from DATABASE_URL so sessions
  // don't invalidate on every hot reload but DO change when the project
  // moves to a different DB.
  const db = process.env.DATABASE_URL || "medreader-dev-fallback";
  return `medreader-dev-secret-${db.length}-${db.slice(-12)}`;
}

export const authOptions: NextAuthOptions = {
  // Provide an explicit secret so JWT encryption/decryption always succeeds,
  // even in environments where NEXTAUTH_SECRET is unset. Without this the
  // admin middleware throws JWEDecryptionFailed and 307s every request.
  secret: resolveAuthSecret(),
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });
        if (!user) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name || undefined,
          role: user.role,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
