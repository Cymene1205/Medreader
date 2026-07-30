# Task f3-pdf — pdf-parse-upgrade-agent

## Task
Implement Feature 3 (PDF parsing upgrade) — 3 files:
1. `src/lib/pdf-parse.ts` — `parsePdf(filePath)` with 3-tier fallback (MinerU → marker_single → pdfjs-dist Node).
2. `src/app/api/upload/route.ts` — multipart upload, save file, create Paper row, async-parse trigger, tracking.
3. `src/app/api/paper/[id]/route.ts` — GET handler returning parse status + (when done) parsed text.

## Files Written
- `/home/z/my-project/src/lib/pdf-parse.ts`
- `/home/z/my-project/src/app/api/upload/route.ts`
- `/home/z/my-project/src/app/api/paper/[id]/route.ts`

## Key Design Decisions
- **pdfjs-dist Node path**: Dynamic `import("pdfjs-dist/legacy/build/pdf.mjs")` with fallback to `import("pdfjs-dist")`. Sets `GlobalWorkerOptions.workerSrc = ""` and passes `{ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }` to `getDocument`. No external worker fetched — pdfjs runs in fake-worker mode on the main thread.
- **Layout reconstruction** in the pdfjs fallback: groups text items by Y (3px tol), sorts top-to-bottom, clusters line start-X positions to detect double-column pages and reads left column top-to-bottom then right, inserts spaces from horizontal gaps / `hasEOL`, inserts blank lines when line gap > 1.5× median line height, prefixes each page with `[Page N]`.
- **MinerU** is opt-in via `MINERU_API_URL`. Multipart POST to `${base}/file`, supports both sync `{markdown}` and async `{task_id}` (polls `${base}/task/{id}` for 2 min). All failures silently fall through to the next tier.
- **marker_single** is spawned as a subprocess (`marker_single <pdf> --output_dir <tmp>`); both flat and nested `.md` output layouts are handled. Temp dir is cleaned up after.
- **Upload route**: module-level `mkdirSync("/home/z/my-project/uploads", { recursive: true })` (also re-checked inside the handler). Saves file as `<randomUUID()>.pdf`. Creates Paper row with `parseStatus="pending"`, optional `userId` from `getServerSession(authOptions)`. Tracks `upload_pdf` event. Fires `void parsePdfBackground(paperId, filePath)` (non-awaited) which updates status to `done`/`error` when finished. Returns `{ paperId, uploadUrl }` immediately.
- **Paper GET route**: Next.js 16 `params: Promise<{ id: string }>` (awaited). Returns `{ id, title, parseStatus, parsedText, createdAt }`. `parsedText` is `null` unless `parseStatus === "done"`. 404 when paper not found.

## Lint / Type Check
- `bun run lint` → **clean pass** (no errors, no warnings) for the new files.
- `bunx tsc --noEmit -p tsconfig.json` → **no errors in the 3 new files**. The remaining TS errors are all pre-existing in unrelated files (`examples/websocket`, `skills/`, `src/app/page.tsx` missing `@/components/mindmap-view`, `src/lib/deepseek.ts`) and outside this task's scope.

## Frontend Compatibility
`src/app/page.tsx` already uploads via `POST /api/upload` and polls `GET /api/paper/${paperId}` until `parseStatus === "done"` (using `serverParsedText` if available, else client-side pdfjs extraction). No client-side changes were required.

## Workarounds / Notes
- Used `crypto.randomUUID()` instead of `cuid` for the saved filename (no extra import; Paper.id remains a Prisma cuid, so the returned `paperId` is still a cuid).
- Documented the assumed MinerU API contract at the top of `pdf-parse.ts` so it can be adjusted if a real MinerU deployment differs.

## Status
✅ Complete. All three files created, lint clean, types check.
