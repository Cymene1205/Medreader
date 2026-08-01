#!/bin/bash
# =============================================================================
# MedReader Agent — server deploy script (full lifecycle)
# =============================================================================
#
# 用法 / Usage:
#
#   【首次部署】(在服务器上执行一次):
#     bash deploy-medreader-full.sh init
#
#   【后续更新代码】(每次 GitHub 有新提交后):
#     bash deploy-medreader-full.sh update
#
#   【只拉代码不重启】(查看代码改动用):
#     bash deploy-medreader-full.sh pull-only
#
#   【查看实时日志】:
#     bash deploy-medreader-full.sh logs
#
#   【重启服务】(不拉代码，仅重启容器):
#     bash deploy-medreader-full.sh restart
#
# 前置条件 / Prerequisites:
#   - 服务器已安装 docker、docker compose、git
#   - 服务器可访问 github.com 和 docker hub
#
# 部署目录 / Deploy path:
#   /opt/medreader
#
# =============================================================================

set -euo pipefail

# ── 配置区 / Config ────────────────────────────────────────────────────────
REPO_URL="https://github.com/Cymene1205/Medreader.git"
DEPLOY_DIR="/opt/medreader"
BRANCH="main"

# API keys (写入 .env.production)
DEEPSEEK_KEY="sk-edb16a1b2daa4982a45307247934cd91"
MINERU_TOKEN="sk-X5ufJB2CZjaU9OezQps3SvNbbMtY3RdeB7VrrzBWYcKYZuad"
ZHIPU_KEY="ab99da4d58cc4f67bb858684be8e50fc.AnqgaeynbqrMTDtR"

# 如果是 private 仓库，把下面这行取消注释并填入你的 GitHub PAT
# (公开仓库不需要，留空即可)
# GH_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxx"

# ── 工具函数 / Helpers ──────────────────────────────────────────────────────
log()  { echo -e "\033[34m==> $*\033[0m"; }
ok()   { echo -e "\033[32m✓ $*\033[0m"; }
warn() { echo -e "\033[33m⚠ $*\033[0m"; }
err()  { echo -e "\033[31m✗ $*\033[0m"; }

ensure_var() {
  # 在 .env.production 中确保某个变量存在并等于指定值
  local key="$1" val="$2" file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
  echo "    $key = ${val:0:12}..."
}

# ── 命令实现 / Commands ────────────────────────────────────────────────────

cmd_init() {
  log "首次部署 MedReader Agent"

  # 1. 检查依赖
  command -v git >/dev/null 2>&1 || { err "未安装 git。请先: apt install -y git"; exit 1; }
  command -v docker >/dev/null 2>&1 || { err "未安装 docker。请先安装 Docker"; exit 1; }
  docker compose version >/dev/null 2>&1 || { err "未安装 docker compose v2"; exit 1; }
  ok "依赖检查通过"

  # 2. clone 仓库 (如果目录已存在则跳过)
  if [ -d "$DEPLOY_DIR/.git" ]; then
    warn "$DEPLOY_DIR 已存在，跳过 clone"
  else
    log "克隆仓库到 $DEPLOY_DIR"
    mkdir -p "$(dirname "$DEPLOY_DIR")"
    if [ -n "${GH_TOKEN:-}" ]; then
      # private 仓库用 token
      git clone --depth 1 -b "$BRANCH" \
        "https://x-access-token:${GH_TOKEN}@github.com/Cymene1205/Medreader.git" \
        "$DEPLOY_DIR"
    else
      # public 仓库直接 clone
      git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$DEPLOY_DIR"
    fi
    ok "克隆完成"
  fi

  cd "$DEPLOY_DIR"
  git log --oneline -3

  # 3. 准备 .env.production
  log "配置 .env.production"
  if [ ! -f ".env.production" ]; then
    if [ -f ".env.production.example" ]; then
      cp .env.production.example .env.production
      ok "从 .env.production.example 创建 .env.production"
    else
      touch .env.production
      warn ".env.production.example 不存在，创建空文件"
    fi
  fi

  ensure_var "DEEPSEEK_API_KEY" "$DEEPSEEK_KEY" .env.production
  ensure_var "MINERU_API_TOKEN" "$MINERU_TOKEN" .env.production
  ensure_var "VISION_BASE_URL"  "https://open.bigmodel.cn/api/paas/v4" .env.production
  ensure_var "VISION_API_KEY"   "$ZHIPU_KEY" .env.production
  ensure_var "VISION_MODEL"     "glm-4v-flash" .env.production
  ensure_var "NEXTAUTH_SECRET"  "$(openssl rand -base64 32)" .env.production
  ensure_var "NEXTAUTH_URL"     "http://localhost:3000" .env.production

  # 4. 清理 docker 缓存 (避免磁盘满)
  log "清理 docker 缓存"
  docker system prune -a -f --volumes=false 2>/dev/null || true
  docker builder prune -a -f 2>/dev/null || true
  ok "docker 缓存已清理"
  df -h / | tail -1 | awk '{print "    磁盘剩余:", $4}'

  # 5. 构建并启动
  log "docker compose up -d --build (首次构建可能需要 5-10 分钟)"
  docker compose down 2>/dev/null || true
  docker compose up -d --build

  # 6. 健康检查
  cmd_healthcheck

  ok "首次部署完成！访问 http://你的服务器IP:3000"
}

cmd_update() {
  log "更新 MedReader Agent (拉取最新代码 + 重新构建)"

  cd "$DEPLOY_DIR" 2>/dev/null || {
    err "$DEPLOY_DIR 不存在，请先执行: bash $0 init"
    exit 1
  }

  # 1. 拉取最新代码
  log "git fetch + reset to origin/$BRANCH"
  git fetch --all --tags
  git reset --hard "origin/$BRANCH"
  git clean -fd   # 删除未跟踪文件
  echo "    当前版本:"
  git log --oneline -3 | sed 's/^/    /'

  # 2. 确保 .env.production 仍然存在且 keys 正确
  if [ ! -f ".env.production" ]; then
    err ".env.production 不见了！请检查是否被 git reset 误删"
    exit 1
  fi
  ensure_var "DEEPSEEK_API_KEY" "$DEEPSEEK_KEY" .env.production
  ensure_var "MINERU_API_TOKEN" "$MINERU_TOKEN" .env.production
  ensure_var "VISION_BASE_URL"  "https://open.bigmodel.cn/api/paas/v4" .env.production
  ensure_var "VISION_API_KEY"   "$ZHIPU_KEY" .env.production
  ensure_var "VISION_MODEL"     "glm-4v-flash" .env.production

  # 3. 清理 docker 缓存
  log "清理 docker 缓存"
  docker system prune -a -f --volumes=false 2>/dev/null || true
  docker builder prune -a -f 2>/dev/null || true

  # 4. 重新构建并启动
  log "docker compose up -d --build"
  docker compose down 2>/dev/null || true
  docker compose up -d --build

  # 5. 健康检查
  cmd_healthcheck

  ok "更新完成！"
}

cmd_pull_only() {
  log "仅拉取代码 (不重启服务)"
  cd "$DEPLOY_DIR" 2>/dev/null || { err "$DEPLOY_DIR 不存在"; exit 1; }
  git fetch --all
  git log --oneline HEAD..origin/$BRANCH | sed 's/^/    新提交: /'
  echo ""
  echo "    本地版本:"
  git log --oneline -3 | sed 's/^/    /'
  echo ""
  echo "    如要应用更新，运行: bash $0 update"
}

cmd_healthcheck() {
  log "等待健康检查 (最多 90 秒)..."
  for i in $(seq 1 18); do
    status=$(docker inspect --format='{{.State.Health.Status}}' medreader 2>/dev/null || echo "starting")
    echo "    attempt $i/18: $status"
    if [ "$status" = "healthy" ]; then
      ok "容器健康！"
      return 0
    fi
    sleep 5
  done
  warn "容器未在 90 秒内变 healthy。最近日志:"
  docker compose logs --tail=30 medreader 2>/dev/null || docker logs --tail=30 medreader 2>/dev/null || true
  warn "如果磁盘满，运行: docker system prune -a -f --volumes && docker builder prune -a -f"
  return 1
}

cmd_logs() {
  log "实时日志 (Ctrl+C 退出)"
  cd "$DEPLOY_DIR" 2>/dev/null || { err "$DEPLOY_DIR 不存在"; exit 1; }
  docker compose logs -f --tail=100 medreader
}

cmd_restart() {
  log "重启容器 (不拉代码)"
  cd "$DEPLOY_DIR" 2>/dev/null || { err "$DEPLOY_DIR 不存在"; exit 1; }
  docker compose restart
  cmd_healthcheck
}

cmd_status() {
  log "容器状态"
  cd "$DEPLOY_DIR" 2>/dev/null || { err "$DEPLOY_DIR 不存在"; exit 1; }
  docker compose ps
  echo ""
  git log --oneline -3 | sed 's/^/    git: /'
}

# ── 入口 / Entry ────────────────────────────────────────────────────────────

case "${1:-}" in
  init)        cmd_init ;;
  update)      cmd_update ;;
  pull-only)   cmd_pull_only ;;
  logs)        cmd_logs ;;
  restart)     cmd_restart ;;
  status)      cmd_status ;;
  healthcheck) cmd_healthcheck ;;
  *)
    cat <<EOF
用法: bash $0 <command>

命令:
  init        首次部署 (clone 仓库 + 构建 + 启动)
  update      拉取最新代码并重新构建 (常用)
  pull-only   只拉代码不重启 (查看有哪些新提交)
  restart     只重启容器不拉代码
  logs        查看实时日志
  status      查看容器和 git 状态
  healthcheck 仅做健康检查

部署目录: $DEPLOY_DIR
仓库地址: $REPO_URL
分支:     $BRANCH
EOF
    exit 1
    ;;
esac
