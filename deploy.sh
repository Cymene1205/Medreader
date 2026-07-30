#!/usr/bin/env bash
# =============================================================================
# MedReader Agent — One-shot deployment script for a fresh Linux server.
# =============================================================================
# Run ON YOUR SERVER (not your local machine) as root or sudo user:
#
#   curl -fsSL <your-repo-url>/deploy.sh | bash
#   — or, if you've cloned the repo onto the server —
#   cd /opt/medreader && bash deploy.sh
#
# What this script does:
#   1. Installs Docker + Docker Compose if missing
#   2. Syncs the latest code (if you cloned the repo) via git pull
#   3. Migrates your existing SQLite DB + uploads to ./data and ./uploads
#   4. Builds the Docker image and starts the container
#   5. Prints the URL to access the app
#
# After the first run, subsequent `bash deploy.sh` calls will just
# git-pull + rebuild + restart.
# =============================================================================

set -euo pipefail

# --- Config -----------------------------------------------------------------
APP_DIR="${APP_DIR:-/opt/medreader}"
SERVER_IP="${SERVER_IP:-47.253.133.131}"
PORT="${PORT:-3000}"

# Colors for pretty output.
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
log()  { echo "${GREEN}[deploy]${NC} $*"; }
warn() { echo "${YELLOW}[warn]${NC}  $*"; }
err()  { echo "${RED}[err]${NC}   $*" >&2; }
step() { echo "${BLUE}[step]${NC} $*"; }

# --- 0. Pre-flight checks ---------------------------------------------------
step "0/5  Pre-flight checks"
if [[ $EUID -eq 0 ]]; then
  warn "running as root — okay, but consider running as a non-root sudo user"
elif ! sudo -n true 2>/dev/null; then
  err "this script needs sudo for Docker installation; please run as a sudo user"
  exit 1
fi

# --- 1. Install Docker if missing -------------------------------------------
step "1/5  Ensure Docker is installed"
if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing via get.docker.com"
  curl -fsSL https://get.docker.com | sudo sh
  sudo systemctl enable --now docker
  sudo usermod -aG docker "${USER:-$(whoami)}" || true
  warn "added you to the docker group; you may need to log out + back in for it to take effect"
else
  log "Docker $(docker --version | awk '{print $3}' | tr -d ',') already installed"
fi

if ! docker compose version >/dev/null 2>&1; then
  err "docker compose plugin missing — install it manually:"
  err "  sudo apt-get update && sudo apt-get install docker-compose-plugin"
  exit 1
fi

# --- 2. Get the code onto the server ----------------------------------------
step "2/5  Sync code to ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  log "existing repo at ${APP_DIR} — pulling latest"
  cd "${APP_DIR}"
  git pull --rebase --autostash || {
    warn "git pull had conflicts — leaving them for you to resolve manually"
    git status
    exit 1
  }
else
  warn "no repo found at ${APP_DIR}"
  read -r -p "Clone URL for the medreader repo (or press Enter to skip and use rsync/scp instead): " REPO_URL
  if [[ -n "${REPO_URL}" ]]; then
    sudo mkdir -p "${APP_DIR}"
    sudo chown "$(whoami)" "${APP_DIR}"
    git clone "${REPO_URL}" "${APP_DIR}"
    cd "${APP_DIR}"
  else
    err "no repo to clone — please rsync/scp your local code to ${APP_DIR} and re-run this script"
    exit 1
  fi
fi

# --- 3. Prepare env file ----------------------------------------------------
step "3/5  Prepare .env.production"
if [[ ! -f .env.production ]]; then
  log "no .env.production found — creating one from template"
  cp .env.production.example .env.production
  # Generate a random NEXTAUTH_SECRET
  SECRET="$(openssl rand -base64 32)"
  # Use sed to replace the placeholder. Some seds don't support -i without
  # a backup file on macOS, so we use a portable form.
  sed -i.bak "s|NEXTAUTH_SECRET=PLEASE_REPLACE_WITH_RANDOM_32_BYTES|NEXTAUTH_SECRET=${SECRET}|" .env.production && rm -f .env.production.bak
  # Set NEXTAUTH_URL to this server's IP
  sed -i.bak "s|NEXTAUTH_URL=http://.*|NEXTAUTH_URL=http://${SERVER_IP}:${PORT}|" .env.production && rm -f .env.production.bak
  warn "Edit .env.production to add your DEEPSEEK_API_KEY / MINERU_API_TOKEN if you don't want to rely on the hardcoded defaults."
else
  log ".env.production already exists — leaving it as-is"
fi

# --- 4. Migrate existing data -----------------------------------------------
step "4/5  Migrate existing SQLite DB + uploads"
mkdir -p data uploads

# If there's an existing db/ dir from the dev environment (file-based SQLite
# at db/custom.db), copy it into ./data so Docker picks it up.
if [[ -f db/custom.db ]]; then
  log "copying db/custom.db → data/custom.db (preserves existing users + papers)"
  cp db/custom.db data/custom.db
  # SQLite journal files, if present.
  [[ -f db/custom.db-journal ]] && cp db/custom.db-journal data/ || true
  [[ -f db/custom.db-wal ]]     && cp db/custom.db-wal     data/ || true
  [[ -f db/custom.db-shm ]]     && cp db/custom.db-shm     data/ || true
else
  log "no existing db/custom.db — starting with a fresh database"
fi

# Same for uploads/.
if [[ -d uploads ]] && [[ -n "$(ls -A uploads 2>/dev/null)" ]]; then
  log "uploads/ already has files — leaving them in place"
else
  log "uploads/ is empty — new users will start fresh"
fi

# --- 5. Build + start -------------------------------------------------------
step "5/5  Build image and start container"
log "running: docker compose up -d --build  (this takes 2-5 minutes on first run)"
docker compose up -d --build

# Wait for the container to be healthy.
log "waiting for the container to become healthy..."
for i in $(seq 1 30); do
  STATUS="$(docker inspect --format='{{.State.Health.Status}}' medreader 2>/dev/null || echo "none")"
  case "${STATUS}" in
    healthy)
      echo
      log "✅ Container is healthy"
      break
      ;;
    unhealthy)
      err "container became unhealthy — showing recent logs:"
      docker compose logs --tail=50 medreader
      exit 1
      ;;
    *)
      printf "."
      sleep 3
      ;;
  esac
done

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
echo "  docker compose up -d --build   # rebuild after git pull"
