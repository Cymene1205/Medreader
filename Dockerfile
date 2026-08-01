# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — deps: install production + dev dependencies (needed for build)
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app

# Bun is used by the project's `start` script in dev. Keep it for parity
# with the local dev workflow.
RUN npm install -g bun

# Copy lockfile + package.json first to maximise Docker layer caching.
COPY package.json bun.lock* package-lock.json* pnpm-lock.yaml* ./

# Install ALL dependencies (including dev) — we need them for `next build`.
# Use npm ci if a package-lock.json exists, else fall back to bun install.
#
# ⚠️ --ignore-scripts is MANDATORY here:
#   package.json has a postinstall hook: `prisma generate && npm run sync-pdfjs-worker`.
#   In the deps stage we only have package.json + lockfile — no prisma/schema.prisma
#   and no node_modules/pdfjs-dist yet — so postinstall would crash the build.
#   We re-run those two commands explicitly in the builder stage after `COPY . .`,
#   where the full source tree is available.
#   Do NOT remove postinstall from package.json — local dev relies on it.
RUN if [ -f package-lock.json ]; then \
      npm ci --ignore-scripts; \
    else \
      bun install --frozen-lockfile --ignore-scripts; \
    fi

# =============================================================================
# Stage 2 — builder: compile the Next.js standalone output
# =============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g bun

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma generate + pdfjs worker sync must run BEFORE next build:
#   - prisma generate: the build imports the generated Prisma Client
#   - sync-pdfjs-worker: copies pdf.worker.min.mjs into public/ so the
#     client can load it at runtime
# These two commands are normally triggered by package.json's postinstall
# hook, but we skipped postinstall in the deps stage with --ignore-scripts
# (schema and pdfjs-dist weren't available there). Re-run them here, where
# the full source tree has been COPYied in.
RUN npx prisma generate && npm run sync-pdfjs-worker

# Build the standalone output. The package.json build script also
# copies .next/static and public into the standalone dir.
RUN npm run build

# =============================================================================
# Stage 3 — runner: minimal runtime image
# =============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Runtime needs:
#   - tini            PID 1 init, properly forwards signals & reaps zombies
#   - ca-certificates TLS for MinerU / DeepSeek / OAuth calls
RUN apk add --no-cache tini ca-certificates

ENV NODE_ENV=production
# Port the standalone server listens on. docker-compose maps 3000:3000.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Where uploaded PDFs + MinerU-extracted images live.
# MUST match the volume mount in docker-compose.yml (./uploads:/app/uploads).
# Without this, the upload route falls back to /home/z/my-project/uploads
# (the dev sandbox path) which doesn't exist in the alpine container —
# files would be written to the container's overlay FS and LOST on rebuild.
ENV UPLOADS_DIR=/app/uploads

# Copy the standalone build — `server.js` lands at /app/server.js.
# `COPY --from=builder /app/.next/standalone ./` copies the CONTENTS of
# `.next/standalone/` into the current WORKDIR (/app), so we end up with:
#   /app/server.js
#   /app/package.json
#   /app/node_modules/...   (only the deps Next.js traced as needed)
#   /app/.next/...          (server chunks, etc.)
COPY --from=builder /app/.next/standalone ./

# Next.js standalone does NOT include `.next/static` or `public/` by
# default — copy them explicitly (fix #4 standard recipe).
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# --- Prisma at runtime ------------------------------------------------------
# The standalone build only carries @prisma/client (traced from app code).
# But we need the `prisma` CLI at runtime to run `prisma db push` on
# container start, which keeps the SQLite schema in sync with the code.
#
# Previous attempt: manually COPY node_modules/prisma + @prisma + .bin/prisma
# from the builder. This broke because prisma 6.x has transitive runtime
# deps (e.g. `effect`) that Next.js standalone tracing also excludes, and
# chasing them by hand is a losing game every prisma release.
#
# New approach: install prisma CLI fresh in the runner via npm. This pulls
# the full, correct dependency tree automatically. It costs ~30s of build
# time and ~50MB of image size, but is robust against prisma version bumps.
#
# We pin the major version to match package.json so the CLI and the
# generated client (carried over from builder below) stay in sync.
RUN npm install --no-save --omit=dev prisma@6

# Schema + generated client come from the builder (already generated there).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Data directories — mounted as volumes in docker-compose, but we create
# them here so the image is also runnable standalone without mounting.
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

# Use tini as PID 1 so SIGTERM from `docker stop` is properly forwarded
# to the Next.js server (otherwise it waits 10s for SIGKILL).
ENTRYPOINT ["/sbin/tini", "--"]

# Run migrations on container start, then start the standalone server.
#   - `npx prisma db push` is idempotent: if schema is in sync it does
#     nothing; if there are new models it applies them.
#   - We deliberately do NOT pass `--accept-data-loss` (fix #4):
#     if Prisma ever decides a schema change would destroy data, we want
#     the container to fail loudly so a human can intervene, rather than
#     silently wipe the production database.
#   - `exec node server.js` replaces the sh process so signals reach
#     Next.js directly.
CMD ["sh", "-c", "npx prisma db push && exec node server.js"]
