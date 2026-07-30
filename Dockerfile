# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — deps: install production + dev dependencies (needed for build)
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app

# Bun is used by the project's `start` script. Install it on top of Node.
RUN npm install -g bun

# Copy lockfile + package.json first to maximise Docker layer caching.
COPY package.json bun.lock* package-lock.json* pnpm-lock.yaml* ./

# Install ALL dependencies (including dev) — we need them for `next build`.
# Use npm ci if a package-lock.json exists, else fall back to bun install.
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      bun install --frozen-lockfile; \
    fi

# =============================================================================
# Stage 2 — builder: compile the Next.js standalone output
# =============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g bun

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# prisma generate must run before next build — the build imports the
# generated Prisma Client.
RUN npx prisma generate

# Build the standalone output. The package.json build script already
# copies .next/static and public into the standalone dir.
RUN npm run build

# =============================================================================
# Stage 3 — runner: minimal runtime image
# =============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

# Install only what the runtime needs:
#  - bun (the start script invokes `bun .next/standalone/server.js`)
#  - tini (PID 1 init, properly forwards signals & reaps zombies)
#  - ca-certificates (TLS for MinerU / DeepSeek / OAuth calls)
RUN apk add --no-cache tini ca-certificates \
 && npm install -g bun

ENV NODE_ENV=production
# Port the standalone server listens on. docker-compose maps 3000:3000.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone build (already contains server.js + static + public).
COPY --from=builder /app/.next/standalone ./
# Prisma needs its schema + generated client at runtime for `db push`.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Data directories — mounted as volumes in docker-compose, but we create
# them here so the image is also runnable standalone without mounting.
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

# Use tini as PID 1 so SIGTERM from `docker stop` is properly forwarded
# to the Next.js server (otherwise it waits 10s for SIGKILL).
ENTRYPOINT ["/sbin/tini", "--"]

# Run migrations on container start, then start the server.
# `prisma db push` is idempotent — if the schema is already in sync it
# does nothing; if there are new models it applies them. The
# `--accept-data-loss` flag is needed because SQLite has no real
# migration history and Prisma refuses to push otherwise.
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && exec bun .next/standalone/server.js"]
