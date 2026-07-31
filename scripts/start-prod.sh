#!/bin/bash
# Start MedReader production server in a fully detached session.
# Usage: bash scripts/start-prod.sh
#   - setsid creates a new session (survives parent bash exit)
#   - nohup ignores SIGHUP
#   - stdin from /dev/null, stdout/stderr to prod.log
#   - disown removes it from the shell job table

cd /home/z/my-project/.next/standalone

setsid nohup env PORT=3000 NODE_ENV=production node server.js \
  < /dev/null \
  > /home/z/my-project/prod.log 2>&1 &

PID=$!
disown $PID 2>/dev/null

# Give it a moment to bind
sleep 2
echo "started node pid=$PID (session leader)"
ps -p $PID -o pid,ppid,sid,stat,cmd 2>/dev/null | head -3
