#!/usr/bin/env bash
# 等效 docker-compose.dev.yml 的本地启动脚本（无需 Docker daemon）
# 用法: bash scripts/run-local.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
RUNTIME="$ROOT/.runtime"

export NEXT_PUBLIC_STORAGE_TYPE=redis
export REDIS_URL=redis://127.0.0.1:6379
export USERNAME=admin
export PASSWORD=admin123
export NEXT_PUBLIC_SITE_NAME=MoonTV
export HOSTNAME=0.0.0.0
export PORT=3000
export DOCKER_ENV=true

# 1) 启动 Redis（如已编译）
if [ ! -x "$RUNTIME/redis-7.2.5/src/redis-server" ]; then
  echo "❌ 未找到 redis-server，请先: bash scripts/build-redis.sh"
  exit 1
fi

echo "🚀 启动 Redis ..."
"$RUNTIME/redis-7.2.5/src/redis-server" --port 6379 --daemonize yes --appendonly no
sleep 1
"$RUNTIME/redis-7.2.5/src/redis-cli" ping

# 2) 组装 standalone（Dockerfile runner 阶段同款布局）
STANDALONE="$ROOT/.next/standalone"
if [ ! -f "$STANDALONE/server.js" ]; then
  echo "❌ 未找到 standalone 产物，请先构建: pnpm build"
  exit 1
fi
[ -d "$STANDALONE/public" ] || cp -r "$ROOT/public" "$STANDALONE/public"
[ -d "$STANDALONE/.next/static" ] || cp -r "$ROOT/.next/static" "$STANDALONE/.next/static"
[ -d "$STANDALONE/scripts" ] || cp -r "$ROOT/scripts" "$STANDALONE/scripts"
[ -f "$STANDALONE/start.js" ] || cp "$ROOT/start.js" "$STANDALONE/start.js"

# 3) 启动应用（容器 CMD 同款: node start.js）
echo "🚀 启动 LunaTV on http://localhost:3000 (admin / admin123)"
cd "$STANDALONE"
exec node start.js
