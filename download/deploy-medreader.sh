#!/bin/bash
# =============================================================================
# MedReader Agent — one-shot deploy script
# =============================================================================
# Run on the server (47.253.133.131) as root / sudo user:
#   scp deploy-medreader.sh root@47.253.133.131:/opt/medreader/
#   ssh root@47.253.133.131
#   cd /opt/medreader && bash deploy-medreader.sh
#
# What this does:
#   1. Clean docker caches so build won't fail with ENOSPC
#   2. git pull latest code (incl. middleware fix + vision GLM-4V refactor)
#   3. Ensure .env.production contains VISION_API_KEY (auto-appended if missing)
#   4. docker compose up -d --build
#   5. Wait for health check
# =============================================================================

set -euo pipefail

cd /opt/medreader 2>/dev/null || {
  echo "ERROR: /opt/medreader not found. Clone the repo first:"
  echo "  git clone https://github.com/Cymene1205/Medreader.git /opt/medreader"
  exit 1
}

echo "==> [1/5] Cleaning docker caches to free disk..."
docker system prune -a -f --volumes=false || true
docker builder prune -a -f || true
echo "    Disk after cleanup:"
df -h / | tail -1

echo ""
echo "==> [2/5] git pull latest code..."
git fetch --all
git reset --hard origin/main
git log --oneline -3

echo ""
echo "==> [3/5] Ensuring .env.production has VISION_* vars..."
ENV_FILE=.env.production
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Create it from .env.production.example first."
  exit 1
fi

# Zhipu GLM-4V key provided by user
ZHIPU_KEY="ab99da4d58cc4f67bb858684be8e50fc.AnqgaeynbqrMTDtR"

# Helper: ensure a key exists in .env.production with a specific value
ensure_var() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    # Replace existing line
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
  echo "    $key = ${val:0:12}..."
}

ensure_var "VISION_BASE_URL" "https://open.bigmodel.cn/api/paas/v4"
ensure_var "VISION_API_KEY"  "$ZHIPU_KEY"
ensure_var "VISION_MODEL"    "glm-4v-flash"

echo ""
echo "==> [4/5] docker compose up -d --build..."
docker compose down 2>/dev/null || true
docker compose up -d --build

echo ""
echo "==> [5/5] Waiting for health check (up to 90s)..."
for i in $(seq 1 18); do
  status=$(docker inspect --format='{{.State.Health.Status}}' medreader 2>/dev/null || echo "starting")
  echo "    attempt $i: $status"
  if [ "$status" = "healthy" ]; then
    echo ""
    echo "✅ Deploy success. Visit http://47.253.133.131:3000"
    exit 0
  fi
  sleep 5
done

echo ""
echo "⚠️  Container not healthy after 90s. Recent logs:"
docker compose logs --tail=50 medreader
echo ""
echo "If you see ENOSPC, run: docker system prune -a -f --volumes && docker builder prune -a -f"
exit 1
