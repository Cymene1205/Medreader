#!/bin/bash
# Persistent dev server launcher for sandboxed preview environments.
# Runs `next dev` fully detached with setsid + nohup, then pings the
# server every 30s for the next 9 minutes to keep the sandbox active
# long enough for the user to access the preview link.

set -e
cd /home/z/my-project

# Kill any previous dev server on port 3000.
pkill -f "next dev" 2>/dev/null || true
sleep 1

# Launch detached.
setsid nohup npx next dev -p 3000 > /tmp/medreader-persistent.log 2>&1 < /dev/null &
disown
echo "[start-dev] launched next dev, pid hints:"
ps aux | grep -E "next dev" | grep -v grep | head -3

# Wait for ready (max 20s).
for i in $(seq 1 20); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null | grep -q "200"; then
    echo "[start-dev] server ready after ${i}s"
    break
  fi
  sleep 1
done

# Keepalive ping loop — every 30s for ~9 minutes (18 pings).
# This keeps the bash tool call running, which keeps the sandbox
# process tree alive. The user can access the preview during this
# window. If they need longer, they can re-run this script.
for i in $(seq 1 18); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo "000")
  echo "[start-dev] ping ${i}/18 → HTTP ${code}"
  sleep 30
done

echo "[start-dev] keepalive window ended; server may continue running detached."
