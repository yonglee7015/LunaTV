#!/usr/bin/env bash
# 本地编译 Redis（仅用于无 Docker 环境的等效运行验证）
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .runtime && cd .runtime
if [ -x redis-7.2.5/src/redis-server ]; then
  echo "redis-server 已存在"
  exit 0
fi
curl -sL -o redis.tar.gz https://download.redis.io/releases/redis-7.2.5.tar.gz
tar xzf redis.tar.gz
cd redis-7.2.5
make -j"$(nproc)" redis-server redis-cli MALLOC=libc
echo "✅ redis-server 编译完成: $(pwd)/src/redis-server"
