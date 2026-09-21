#!/usr/bin/env bash
# 绿茵BIT 服务器端一键部署（Ubuntu 22.04，建议 root 运行）
# 用法：
#   无域名（用 IP:3000 访问）: bash scripts/deploy-server.sh
#   有域名（自动 HTTPS）:       bash scripts/deploy-server.sh soccer.example.com
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DOMAIN="${1:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行：sudo bash scripts/deploy-server.sh"
  exit 1
fi

echo "[1/5] 安装基础工具..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl unzip openssl ca-certificates

if ! command -v docker >/dev/null 2>&1; then
  echo "[2/5] 安装 Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  echo "[2/5] Docker 已安装，跳过。"
fi
docker compose version >/dev/null

echo "[3/5] 写入配置 .env ..."
if [ ! -f .env ]; then
  cp .env.example .env
fi
if grep -q '^JWT_SECRET=' .env; then
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=$(openssl rand -hex 32)#" .env
else
  echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
fi
grep -q '^PUBLIC_PORT=' .env || echo 'PUBLIC_PORT=3000' >> .env
grep -q '^SMS_MODE=' .env || echo 'SMS_MODE=demo' >> .env
if [ -n "$DOMAIN" ]; then
  if grep -q '^DOMAIN=' .env; then
    sed -i "s#^DOMAIN=.*#DOMAIN=$DOMAIN#" .env
  else
    echo "DOMAIN=$DOMAIN" >> .env
  fi
fi

echo "[4/5] 构建并启动服务..."
if [ -n "$DOMAIN" ]; then
  docker compose --profile https up -d --build
else
  docker compose up -d --build
fi

sleep 3
echo "[5/5] 状态与健康检查..."
docker compose ps || true
echo "--- health ---"
curl -s http://127.0.0.1:3000/api/health || true
echo
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$DOMAIN" ]; then
  echo "访问地址：https://$DOMAIN"
else
  echo "访问地址：http://$IP:3000"
fi
echo "数据库文件在：$ROOT/data/greensinbit.db（请定期备份）"
