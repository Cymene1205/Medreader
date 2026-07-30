---
## Task ID: f1-auth
**Agent name:** auth-agent
**Task:** Implement Feature 1 (auth system) for the MedReader Agent Next.js 16 project.

### Work Log

Created the following 7 files (per task spec):

1. `src/app/api/auth/[...nextauth]/route.ts`
   - Re-exports NextAuth handler as `GET` and `POST` using the shared `authOptions` from `@/lib/auth`. Did NOT modify `auth.ts`.

2. `src/app/api/auth/register/route.ts`
   - `POST {email, password, name?}` JSON endpoint.
   - Validates email format (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), password length >= 8, lowercases email, checks uniqueness via `db.user.findUnique`.
   - Hashes password with `bcrypt.hash(password, 10)`, creates User with `role: "user"`.
   - Returns `{ok:true, user:{id,email,name,role}}` on 201, or `{error}` with 400/409/500 status codes.

3. `src/app/login/page.tsx`
   - Client component with shadcn `Card` / `Input` / `Button` / `Label`.
   - `useSearchParams` reads `callbackUrl`, wrapped in `React.Suspense` (required by Next 16).
   - Calls `signIn("credentials", { email, password, redirect:false, callbackUrl })`. On error shows inline alert; on success `router.push(res.url || callbackUrl || "/")` + `router.refresh()`.
   - Link to `/register` ("还没有账号？注册").

4. `src/app/register/page.tsx`
   - Client component, same visual style as login.
   - Fields: name(optional), email, password, confirmPassword.
   - Client-side validation: email regex, password length >= 8, password === confirmPassword.
   - POSTs to `/api/auth/register`. On success calls `signIn("credentials", ...)` with `redirect:false`, then `router.push("/")`. On auto-login failure falls back to `/login`.
   - Link to `/login` ("已有账号？登录").

5. `src/middleware.ts`
   - `withAuth({ pages: { signIn: "/login" } })` with `config.matcher = ["/admin/:path*", "/api/admin/:path*"]`.
   - Only protects admin routes (Feature 2 territory). Home `/`, auth pages, and APIs remain accessible without a token — matches the spec instruction to let non-logged-in users try the app.

6. `src/components/providers.tsx` + edits to `src/app/layout.tsx`
   - New client component `Providers` wraps children with `SessionProvider` from `next-auth/react`.
   - `layout.tsx` (server) imports `Providers` and wraps `{children}` + `<Toaster />` with it. All existing content (Geist fonts, metadata, Toaster) preserved.

7. `scripts/create-admin.ts`
   - Standalone bun script. Reads `ADMIN_EMAIL` / `ADMIN_PASSWORD` from env (defaults `admin@local` / `admin123456`).
   - Hashes password with bcrypt, `db.user.upsert` with `role: "admin"`, prints success.
   - Verified it bundles cleanly with `bun build` (resolves `@/lib/db` and `bcryptjs`).

### Lint result
`bun run lint` → **exit 0, no errors**. No fixes were needed.

### Notes / Caveats

- The dev server currently emits 500s on `/`, `/login`, `/register`, and `/api/auth/*`.
  Root cause (verified by reading the error response from `/api/auth/providers`)
  is a **pre-existing** compile error in `src/app/page.tsx`:

      Module not found: Can't resolve '@/components/mindmap-view'

  `src/app/page.tsx` imports `MindmapView from "@/components/mindmap-view"`
  but no such file exists in `src/components/`. Because `page.tsx` is a
  client component in the root of the App Router, the whole client bundle
  fails to compile, which makes every route return 500.

  This is **out of scope** for f1-auth: the task explicitly forbids
  modifying `src/app/page.tsx`. The home-page / mindmap agent (likely
  f3 or a mindmap-view task) needs to either create
  `src/components/mindmap-view.tsx` or remove the import. My auth files
  are structurally correct and `bun run lint` passes; the runtime 500s
  will disappear as soon as the missing component is added.

- The shared `auth.ts`, `db.ts`, `prisma/schema.prisma`, and the four
  API routes I was told not to touch were left unchanged.

- `agent-ctx` directory: `/agent-ctx` was not writable in this sandbox
  (`mkdir: cannot create directory '/agent-ctx': Permission denied`),
  so work records are stored at `/home/z/my-project/agent-ctx/` instead.

### Stage Summary
Feature 1 (auth) is code-complete: NextAuth route, registration endpoint,
login/register pages, admin-protecting middleware, SessionProvider wiring,
and admin bootstrap script are all in place and lint-clean. Runtime
verification is blocked only by an unrelated missing component
(`@/components/mindmap-view`) imported by `src/app/page.tsx`.
