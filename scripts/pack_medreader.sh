#!/usr/bin/env bash
# Pack medreader_github/ into a deployable tarball, excluding dev/runtime junk.
set -euo pipefail

SRC=/home/z/my-project/medreader_github
OUT=/home/z/my-project/download/deploy/medreader.tar.gz

cd "$SRC"

# Sanity checks: critical deploy files must exist
for f in Dockerfile docker-compose.yml .env.production.example \
         deploy.sh package.json bun.lock next.config.ts \
         prisma/schema.prisma src public; do
  [[ -e "$f" ]] || { echo "missing: $f"; exit 1; }
done

# Use plain gzip for max compatibility (server may not have zstd/xz)
tar --exclude='./node_modules' \
    --exclude='./.next' \
    --exclude='./.next/cache' \
    --exclude='./db' \
    --exclude='./uploads' \
    --exclude='./data' \
    --exclude='./prisma/dev.db' \
    --exclude='./prisma/*.db-journal' \
    --exclude='./prisma/*.db-wal' \
    --exclude='./prisma/*.db-shm' \
    --exclude='./*.db' \
    --exclude='./*.db-journal' \
    --exclude='./*.db-wal' \
    --exclude='./*.db-shm' \
    --exclude='./.git' \
    --exclude='./dev.log' \
    --exclude='./dev.pid' \
    --exclude='./agent-ctx' \
    --exclude='./tool-results' \
    --exclude='./skills' \
    --exclude='./worklog.md' \
    --exclude='./.vscode' \
    --exclude='./.idea' \
    --exclude='./.DS_Store' \
    --exclude='./*.log' \
    --exclude='./.env' \
    --exclude='./.env.local' \
    --exclude='./.env.production' \
    --exclude='./.env.*.local' \
    --exclude='./download' \
    --exclude='./tests' \
    -czf "$OUT" .

echo "wrote $OUT"
ls -lh "$OUT"
echo "---"
echo "tarball contents (top level):"
tar -tzf "$OUT" | awk -F/ '{print $1"/"$2}' | sort -u | head -30
