#!/usr/bin/env bash
# =============================================================================
# MedReader Agent — Server Disk Cleanup Script
# =============================================================================
# Run on the server (47.253.133.131) as root or sudo user BEFORE deploying.
#
#   ssh admin@47.253.133.131
#   curl -fsSL <your-url>/cleanup.sh | sudo bash
#   — or, after scp —
#   sudo bash cleanup.sh
#
# What this script does:
#   0. Shows disk usage BEFORE cleanup (so you can see what's eating space)
#   1. Stops + removes old Docker containers/images/volumes/build cache
#   2. Trims systemd journal logs to 100 MB
#   3. Cleans apt cache + autoremove orphan packages
#   4. Removes rotated/old logs in /var/log
#   5. Removes old /tmp junk older than 7 days
#   6. Removes the previous /opt/medreader tarball (if any)
#   7. Shows disk usage AFTER cleanup + a delta
#
# This script is IDEMPOTENT and SAFE to run multiple times.
# It does NOT touch:
#   - Your home directory data
#   - /opt/medreader/data (the live SQLite db)
#   - /opt/medreader/uploads (user PDFs)
#   - Anything outside the categories listed above
# =============================================================================

set -euo pipefail

# Colors
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
log()  { echo "${GREEN}[cleanup]${NC} $*"; }
warn() { echo "${YELLOW}[warn]${NC}   $*"; }
err()  { echo "${RED}[err]${NC}     $*" >&2; }
step() { echo "${BLUE}[step]${NC}   $*"; }

# Must run as root or have sudo
if [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
  err "this script needs root or passwordless sudo"
  err "re-run as:  sudo bash $0"
  exit 1
fi
SUDO=""
[[ $EUID -ne 0 ]] && SUDO="sudo"

# Helper: capture disk usage of root fs as "used_MiB avail_MiB"
get_disk_usage() {
  df -BM --output=used,avail / | awk 'NR==2 {gsub("M","",$1); gsub("M","",$2); print $1, $2}'
}

# =============================================================================
# 0. BEFORE snapshot
# =============================================================================
step "0/7  Disk usage BEFORE cleanup"
BEFORE=($(get_disk_usage))
BEFORE_USED=${BEFORE[0]}
BEFORE_AVAIL=${BEFORE[1]}
${SUDO} du -hx --max-depth=1 / 2>/dev/null | sort -rh | head -15 || true
echo
log "root fs:  used ${BEFORE_USED} MiB  |  avail ${BEFORE_AVAIL} MiB"
echo

# =============================================================================
# 1. Docker cleanup
# =============================================================================
step "1/7  Docker cleanup"
if command -v docker >/dev/null 2>&1; then
  log "stopping + removing all containers (incl. medreader if running)..."
  ${SUDO} docker ps -aq 2>/dev/null | xargs -r ${SUDO} docker rm -f 2>/dev/null || true

  log "pruning images, networks, build cache, dangling volumes..."
  ${SUDO} docker system prune -af --volumes 2>&1 | tail -5 || true
  log "docker done"
else
  warn "docker not installed — skipping (will be installed by deploy.sh)"
fi
echo

# =============================================================================
# 2. systemd journal
# =============================================================================
step "2/7  Trim systemd journal to 100 MB"
if command -v journalctl >/dev/null 2>&1; then
  ${SUDO} journalctl --vacuum-size=100M 2>&1 | tail -3 || true
else
  warn "journalctl not found — skipping"
fi
echo

# =============================================================================
# 3. apt
# =============================================================================
step "3/7  apt cache + autoremove"
if command -v apt-get >/dev/null 2>&1; then
  ${SUDO} apt-get clean -y 2>&1 | tail -2 || true
  ${SUDO} apt-get autoremove -y 2>&1 | tail -3 || true
else
  warn "apt-get not found (non-Debian?) — skipping"
fi
echo

# =============================================================================
# 4. /var/log rotation leftovers
# =============================================================================
step "4/7  Remove rotated log files (.gz, .1, .old)"
# Remove rotated logs but keep the live ones
${SUDO} find /var/log -type f \( -name "*.gz" -o -name "*.1" -o -name "*.1.gz" \
  -o -name "*.2.gz" -o -name "*.old" \) -delete 2>/dev/null || true
# Truncate large single files (don't delete — services may have them open)
${SUDO} find /var/log -type f -size +50M -exec truncate -s 0 {} \; 2>/dev/null || true
log "logs trimmed"
echo

# =============================================================================
# 5. /tmp junk
# =============================================================================
step "5/7  Remove /tmp files older than 7 days"
${SUDO} find /tmp -type f -atime +7 -delete 2>/dev/null || true
${SUDO} find /var/tmp -type f -atime +7 -delete 2>/dev/null || true
echo

# =============================================================================
# 6. Old tarballs in /opt
# =============================================================================
step "6/7  Remove old /opt/medreader*.tar.gz (if any)"
${SUDO} find /opt -maxdepth 2 -type f -name "medreader*.tar.gz" -delete 2>/dev/null || true
echo

# =============================================================================
# 7. AFTER snapshot + delta
# =============================================================================
step "7/7  Disk usage AFTER cleanup"
AFTER=($(get_disk_usage))
AFTER_USED=${AFTER[0]}
AFTER_AVAIL=${AFTER[1]}
log "root fs:  used ${AFTER_USED} MiB  |  avail ${AFTER_AVAIL} MiB"
echo

FREED=$(( AFTER_AVAIL - BEFORE_AVAIL ))
if (( FREED > 0 )); then
  log "freed approximately ${FREED} MiB of available space"
elif (( FREED < 0 )); then
  warn "available space DECREASED by $(( -FREED )) MiB (something is still writing?)"
else
  log "no change in available space (already clean?)"
fi

echo
log "============================================================"
if (( AFTER_AVAIL < 1024 )); then
  err "WARNING: only ${AFTER_AVAIL} MiB free — MedReader build needs ~1.5 GiB"
  err "free up more space before running deploy.sh"
  err "(try: sudo du -hx --max-depth=2 / | sort -rh | head -20)"
  exit 2
else
  log "ready to deploy — at least ${AFTER_AVAIL} MiB free"
  log "next step:  scp medreader.tar.gz admin@<server>:/opt/"
  log "            ssh admin@<server>"
  log "            cd /opt && sudo bash deploy-from-tarball.sh"
  log "============================================================"
fi
