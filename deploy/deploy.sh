#!/usr/bin/env bash
# ============================================================================
# 工科影展：在【云主机上】执行一次完整部署
#
#   sudo -u gongke bash deploy/deploy.sh
#
# 做的事（顺序即依赖顺序）：
#   1. 校验仓库干净、依赖装齐
#   2. 构建前端（生产走 api 数据源 + 同源接口 + 根路径）
#   3. 构建后端（server/dist）
#   4. 应用数据库迁移（用 postgres，不是 app_user）
#   5. 重启 API 服务
#   6. 冒烟检查本地 health 与公网首页
#
# 只需要人工提供两样东西：
#   - PGPASSWORD 环境变量（postgres 超级用户密码，仅用于跑迁移，不进服务配置）
#   - /etc/gongke/api.env（见 deploy/api-env-example.txt）
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/gongke}"
DOMAIN="${DOMAIN:-}"
SERVICE="${SERVICE:-gongke-api}"
API_LOCAL="http://127.0.0.1:${API_PORT:-3001}/api/health"

step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }

step "0. 前置检查"
cd "$APP_DIR" || fail "找不到项目目录 $APP_DIR"
command -v node >/dev/null || fail "没有 node"
command -v pnpm >/dev/null || fail "没有 pnpm（npm i -g pnpm）"
command -v psql >/dev/null || fail "没有 psql（装 postgresql-client）"
echo "目录：$APP_DIR"
echo "提交：$(git rev-parse --short HEAD 2>/dev/null || echo '（非 git 工作区）')"
node --version
pnpm --version

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "[警告] 工作区有未提交改动，部署出去的将不是某个确定的提交。"
fi

[[ -f /etc/gongke/api.env ]] || fail "缺少 /etc/gongke/api.env（见 deploy/api-env-example.txt）"
if grep -q '^TURNSTILE_PROVIDER=cloudflare' /etc/gongke/api.env; then
  [[ -n "${VITE_TURNSTILE_SITE_KEY:-}" ]] || fail "后端启用了 Turnstile，但没给 VITE_TURNSTILE_SITE_KEY（前端 widget 需要它，否则注册/登录拿不到 token）"
fi

step "1. 安装依赖（锁定版本）"
pnpm install --frozen-lockfile
pnpm --dir server install --frozen-lockfile

step "2. 构建前端（api 数据源 + 同源 + 根路径）"
# 生产下 Caddy 把站点与 /api 放在同一个域名下，因此不需要 VITE_API_BASE，
# 用 VITE_ALLOW_SAME_ORIGIN=1 显式声明同源（这也正是构建期断言要求的那一步）。
VITE_BASE="${VITE_BASE:-/}" \
VITE_DATA_SOURCE=api \
VITE_ALLOW_SAME_ORIGIN=1 \
VITE_TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-}" \
  pnpm build
pnpm postbuild
[[ -f dist/index.html ]] || fail "dist/index.html 没生成"

step "3. 构建后端"
pnpm --dir server build
[[ -f server/dist/index.js ]] || fail "server/dist/index.js 没生成"

step "4. 应用数据库迁移"
if [[ -z "${PGPASSWORD:-}" ]]; then
  fail "跑迁移需要 PGPASSWORD（postgres 超级用户）；它只用于这一步，不写进 api.env"
fi
PGUSER="${PGADMIN_USER:-postgres}" \
PGDATABASE="${PGDATABASE:-gongke}" \
  node scripts/apply-migrations.mjs

step "5. 重启 API"
if systemctl is-enabled "$SERVICE" >/dev/null 2>&1; then
  sudo systemctl restart "$SERVICE"
else
  echo "[警告] $SERVICE 未安装为 systemd 服务，跳过重启；请按 deploy/README.md 第 6 步安装。"
fi

step "6. 冒烟检查"
sleep 2
health="$(curl -fsS "$API_LOCAL" || true)"
[[ -n "$health" ]] || fail "本地 $API_LOCAL 无响应，用 journalctl -u $SERVICE -n 80 看日志"
echo "health: $health"
# 服务必须是以 app_user 身份连库的（isSuperuser 必须是 false，否则 RLS 形同虚设）
echo "$health" | grep -q '"isSuperuser":false' || fail "数据库连接不是非超级用户，RLS 不会生效，请检查 api.env 的 PGUSER"

if [[ -n "$DOMAIN" ]]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/")"
  echo "公网 https://$DOMAIN/ → HTTP $code"
  [[ "$code" == "200" ]] || fail "公网首页不是 200（检查 Caddy 与 DNS/证书）"
  api_code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/health")"
  echo "公网 /api/health → HTTP $api_code"
  [[ "$api_code" == "200" ]] || fail "公网 API 不通"
fi

step "完成"
echo "部署结束。回滚：git checkout <上一个提交> && bash deploy/deploy.sh"
