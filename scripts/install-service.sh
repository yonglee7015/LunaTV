#!/usr/bin/env bash
# LunaTV 一键部署 + 开机自启（Linux + Docker compose + systemd）
# 用法（在有 Docker 的机器上）:
#   sudo bash scripts/install-service.sh
#
# 作用:
#   1. 检查 docker 与 docker compose
#   2. 可选生成 .env（站长账号密码）
#   3. 本地构建镜像并 docker compose up -d
#   4. 安装 systemd 单元 lunatv.service，开机自动拉起整个 compose 栈
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

say()  { printf '\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31mXX %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 1. 前置检查 ----------
command -v docker >/dev/null || die "未找到 docker，请先安装 Docker（https://docs.docker.com/engine/install/）"
docker compose version >/dev/null 2>&1 || die "docker compose 不可用，请安装 compose 插件"
if ! docker info >/dev/null 2>&1; then
  die "docker 守护进程未运行或当前用户无权限。请先: sudo systemctl enable --now docker，并把用户加入 docker 组或使用 sudo。"
fi

# ---------- 2. .env ----------
# 若以 sudo 运行，则把生成的文件归还给调用者，避免普通用户后续 docker compose 读不了 .env
RUN_USER="${SUDO_USER:-$(id -un)}"
if [ ! -f .env ]; then
  USERNAME="${LUNA_USERNAME:-admin}"
  PASSWORD="${LUNA_PASSWORD:-$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)}"
  cat > .env <<EOF
USERNAME=${USERNAME}
PASSWORD=${PASSWORD}
EOF
  chmod 600 .env
  chown "$RUN_USER" .env 2>/dev/null || true
  warn "已生成 .env：USERNAME=${USERNAME}  PASSWORD=${PASSWORD}（请妥善保存！）"
else
  chown "$RUN_USER" .env 2>/dev/null || true
  say "检测到已有 .env，沿用其中配置"
fi

# ---------- 3. 构建并启动 ----------
say "构建镜像并启动容器（首次构建约需数分钟）..."
docker compose up -d --build

say "等待应用就绪..."
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:3000/login" 2>/dev/null; then
    break
  fi
  sleep 2
  [ "$i" = 60 ] && die "应用 120 秒内未就绪，请查看: docker compose logs -f app"
done

# ---------- 4. 开机自启（Docker 原生机制） ----------
# 容器已配置 restart: unless-stopped，只需保证 docker 服务开机自启即可，
# 开机后容器会按重启策略自动恢复，无需额外的 oneshot systemd 单元。
if command -v systemctl >/dev/null 2>&1; then
  # 清理旧的 oneshot 单元（若存在），避免时序冲突
  if [ -f /etc/systemd/system/lunatv.service ]; then
    systemctl disable lunatv.service 2>/dev/null || true
    rm -f /etc/systemd/system/lunatv.service
    systemctl daemon-reload
    say "已移除旧的 lunatv.service（改为 Docker 原生自启）"
  fi
  systemctl enable docker >/dev/null 2>&1 || true
  say "已确保 docker 服务开机自启（容器按 restart: unless-stopped 自动恢复）"
else
  warn "未检测到 systemctl，无法设置 docker 开机自启，请手动确保 docker 服务随系统启动"
fi

# ---------- 5. 汇总 ----------
USERNAME_VAL=$(grep -E '^USERNAME=' .env | cut -d= -f2 || true)
PASSWORD_VAL=$(grep -E '^PASSWORD=' .env | cut -d= -f2 || true)
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1)
cat <<EOF

✔ 部署完成！
   网站地址: http://${IP:-127.0.0.1}:3000  (本机: http://127.0.0.1:3000)
   站长账号: ${USERNAME_VAL:-admin}
   站长密码: ${PASSWORD_VAL:-见上方输出}

常用命令:
   查看状态: docker compose ps
   查看日志: docker compose logs -f app
   手动重启: docker compose restart app
   停止服务: sudo systemctl stop lunatv   (开机自启随之失效可 systemctl disable)
   完全删除: docker compose down
EOF
