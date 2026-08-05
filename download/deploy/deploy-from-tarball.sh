#!/usr/bin/env bash
# =============================================================================
# MedReader Agent — Deploy from tarball (no Git required)
# =============================================================================
# Use this AFTER you've uploaded medreader.tar.gz to the server via scp.
#
# Local (your dev machine):
#   scp /home/z/my-project/download/deploy/medreader.tar.gz \
#       admin@47.253.133.131:/opt/
#   scp /home/z/my-project/download/deploy/deploy-from-tarball.sh \
#       admin@47.253.133.131:/opt/
#
# Server:
#   ssh admin@47.253.133.131
#   cd /opt
#   sudo bash deploy-from-tarball.sh
#
# What this script does:
#   1. Installs Docker if missing
#   2. Extracts medreader.tar.gz to /opt/medreader
#   3. Generates .env.production (random NEXTAUTH_SECRET, server IP)
#   4. Migrates existing SQLite db + uploads (if found)
#   5. docker compose up -d --build
#   6. Waits for health check, prints URL
#
# Re-run after uploading a new tarball:
#   sudo bash deploy-from-tarball.sh   # extracts on top + rebuilds
# =============================================================================

set -euo pipefail

# --- Config -----------------------------------------------------------------
APP_DIR="${APP_DIR:-/opt/medreader}"
TARBALL="${TARBALL:-/opt/medreader.tar.gz}"
SERVER_IP="${SERVER_IP:-47.253.133.131}"
PORT="${PORT:-3000}"

# Colors
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
log()  { echo "${GREEN}[deploy]${NC} $*"; }
warn() { echo "${YELLOW}[warn]${NC}  $*"; }
err()  { echo "${RED}[err]${NC}   $*" >&2; }
step() { echo "${BLUE}[step]${NC} $*"; }

# --- Pre-flight -------------------------------------------------------------
if [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
  err "needs root or passwordless sudo — re-run as:  sudo bash $0"
  exit 1
fi
SUDO=""
[[ $EUID -ne 0 ]] && SUDO="sudo"

# --- 1. Docker --------------------------------------------------------------
step "1/6  Ensure Docker is installed"
if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing via get.docker.com"
  curl -fsSL https://get.docker.com | ${SUDO} sh
  ${SUDO} systemctl enable --now docker
  ${SUDO} usermod -aG docker "${USER:-$(whoami)}" || true
  warn "added you to docker group; may need to log out + back in"
else
  log "Docker $(docker --version | awk '{print $3}' | tr -d ',') already installed"
fi
if ! docker compose version >/dev/null 2>&1; then
  err "docker compose plugin missing — install manually:"
  err "  sudo apt-get update && sudo apt-get install docker-compose-plugin"
  exit 1
fi

# --- 2. Extract tarball -----------------------------------------------------
step "2/6  Extract ${TARBALL} → ${APP_DIR}"
if [[ ! -f "${TARBALL}" ]]; then
  err "tarball not found at ${TARBALL}"
  err "upload it first:  scp medreader.tar.gz admin@<server>:/opt/"
  exit 1
fi

# Preserve data + uploads + .env across redeploys
BACKUP_DATA=""
if [[ -d "${APP_DIR}/data" ]]; then
  BACKUP_DATA="$(mktemp -d)"
  log "preserving existing ${APP_DIR}/data → ${BACKUP_DATA}/data"
  cp -a "${APP_DIR}/data" "${BACKUP_DATA}/data"
fi
BACKUP_UPLOADS=""
if [[ -d "${APP_DIR}/uploads" ]]; then
  BACKUP_UPLOADS="$(mktemp -d)"
  log "preserving existing ${APP_DIR}/uploads → ${BACKUP_UPLOADS}/uploads"
  cp -a "${APP_DIR}/uploads" "${BACKUP_UPLOADS}/uploads"
fi
BACKUP_ENV=""
if [[ -f "${APP_DIR}/.env.production" ]]; then
  BACKUP_ENV="$(mktemp)"
  log "preserving existing ${APP_DIR}/.env.production"
  cp "${APP_DIR}/.env.production" "${BACKUP_ENV}"
fi

# Wipe + re-extract (cleaner than overlay; avoids stale deleted files)
${SUDO} rm -rf "${APP_DIR}"
${SUDO} mkdir -p "${APP_DIR}"
${SUDO} chown "$(whoami)" "${APP_DIR}"
tar -xzf "${TARBALL}" -C "${APP_DIR}"

# Restore preserved data
if [[ -n "${BACKUP_DATA}" ]]; then
  log "restoring data/"
  rm -rf "${APP_DIR}/data"
  cp -a "${BACKUP_DATA}/data" "${APP_DIR}/data"
  rm -rf "${BACKUP_DATA}"
fi
if [[ -n "${BACKUP_UPLOADS}" ]]; then
  log "restoring uploads/"
  rm -rf "${APP_DIR}/uploads"
  cp -a "${BACKUP_UPLOADS}/uploads" "${APP_DIR}/uploads"
  rm -rf "${BACKUP_UPLOADS}"
fi

cd "${APP_DIR}"

# --- 3. .env.production -----------------------------------------------------
step "3/6  Prepare .env.production"
if [[ -n "${BACKUP_ENV}" ]]; then
  log "restoring previous .env.production"
  cp "${BACKUP_ENV}" .env.production
  rm -f "${BACKUP_ENV}"
elif [[ ! -f .env.production ]]; then
  log "no .env.production found — creating one from template"
  cp .env.production.example .env.production
  SECRET="$(openssl rand -base64 32)"
  sed -i "s|NEXTAUTH_SECRET=PLEASE_REPLACE_WITH_RANDOM_32_BYTES|NEXTAUTH_SECRET=${SECRET}|" .env.production
  sed -i "s|NEXTAUTH_URL=http://.*|NEXTAUTH_URL=http://${SERVER_IP}:${PORT}|" .env.production
  warn "edit .env.production to add DEEPSEEK_API_KEY / MINERU_API_TOKEN if needed"
else
  log ".env.production already exists — leaving it"
fi

# --- 4. Migrate existing dev data (if present in the tarball) ---------------
step "4/6  Migrate SQLite DB + uploads"
mkdir -p data uploads
if [[ -f db/custom.db ]]; then
  log "copying db/custom.db → data/custom.db (preserves users + papers)"
  cp db/custom.db data/custom.db
  [[ -f db/custom.db-journal ]] && cp db/custom.db-journal data/ || true
  [[ -f db/custom.db-wal ]]     && cp db/custom.db-wal     data/ || true
  [[ -f db/custom.db-shm ]]     && cp db/custom.db-shm     data/ || true
else
  log "no db/custom.db in tarball — starting fresh"
fi

# --- 5. Build + start -------------------------------------------------------
step "5/6  docker compose up -d --build  (2-5 min on first run)"
docker compose up -d --build

# --- 6. Health check --------------------------------------------------------
step "6/6  Wait for health check"
log "waiting for the container to become healthy..."
HEALTHY=0
for i in $(seq 1 40); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' medreader 2>/dev/null || echo "none")"
  case "${STATUS}" in
    healthy)
      echo
      log "container is healthy"
      HEALTHY=1
      break
      ;;
    unhealthy)
      err "container became unhealthy — recent logs:"
      docker compose logs --tail=80 medreader
      exit 1
      ;;
    *)
      printf "."
      sleep 3
      ;;
  esac
done

if [[ "${HEALTHY}" -ne 1 ]]; then
  warn "health check timed out — container may still be starting up"
  warn "check logs:  docker compose logs -f medreader"
fi

echo
log "============================================================"
log "  MedReader Agent is running"
log "  →  http://${SERVER_IP}:${PORT}"
log "============================================================"
echo
log "Useful commands:"
echo "  cd ${APP_DIR}"
echo "  docker compose logs -f         # follow logs"
echo "  docker compose restart         # restart after env change"
echo "  docker compose down            # stop"
echo "  docker compose up -d --build   # rebuild after new tarball"
echo
log "If port 3000 is unreachable, open it in Alibaba Cloud security group:"
echo "  protocol: TCP   port: 3000/3000   source: 0.0.0.0/0"
