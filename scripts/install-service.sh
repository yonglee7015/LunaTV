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
if [ ! -f .env ]; then
  USERNAME="${LUNA_USERNAME:-admin}"
  PASSWORD="${LUNA_PASSWORD:-$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)}"
  cat > .env <<EOF
USERNAME=${USERNAME}
PASSWORD=${PASSWORD}
EOF
  chmod 600 .env
  warn "已生成 .env：USERNAME=${USERNAME}  PASSWORD=${PASSWORD}（请妥善保存！）"
else
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

# ---------- 4. systemd 开机自启 ----------
if command -v systemctl >/dev/null 2>&1; then
  UNIT=/etc/systemd/system/lunatv.service
  say "安装开机自启服务 $UNIT"
  cat > "$UNIT" <<EOF
[Unit]
Description=LunaTV (docker compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$ROOT
ExecStart=/usr/bin/env docker compose up -d
ExecStop=/usr/bin/env docker compose down
ExecReload=/usr/bin/env docker compose up -d
StandardOutput=journal
User=root

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable lunatv.service >/dev/null
  say "已启用 lunatv.service（开机自动 docker compose up）"
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
