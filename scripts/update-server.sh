#!/usr/bin/env bash
# =============================================================
# 服务器更新代码：先备份，再拉代码、重建、健康检查
#
# 用法（在服务器上、仓库根目录执行）：
#   bash scripts/update-server.sh
#
# 为什么要有这个脚本：
#   data/ 目录（数据库 + 学生卡照片）不在 git 里，git pull 不会碰它；
#   但为了万无一失，每次更新前先自动备份一份，出问题可以立刻回滚。
# =============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_REL="server/data/backups/update-$STAMP"

echo "=================================================="
echo "[1/4] 备份数据（数据库 + 上传文件）"
echo "=================================================="
if docker compose ps --status running --format '{{.Name}}' 2>/dev/null | grep -q .; then
  # 容器已在运行：用容器里的脚本做一致性快照（VACUUM INTO），不用停机
  if docker compose exec -T web node scripts/backup-db.mjs --out "$BACKUP_REL" 2>/dev/null; then
    echo "[备份] 已写入 $BACKUP_REL"
  else
    echo "[备份] 容器内脚本不可用，退化为主机侧拷贝（建议更新后再跑一次备份）"
    mkdir -p "$BACKUP_REL"
    cp -a data/greensinbit.db "$BACKUP_REL/" 2>/dev/null || true
    cp -a data/uploads "$BACKUP_REL/" 2>/dev/null || true
  fi
else
  echo "[备份] 服务未运行，直接拷贝数据文件"
  mkdir -p "$BACKUP_REL"
  cp -a data/greensinbit.db "$BACKUP_REL/" 2>/dev/null || true
  cp -a data/uploads "$BACKUP_REL/" 2>/dev/null || true
fi
ls -lh "$BACKUP_REL" || true

echo
echo "=================================================="
echo "[2/4] 拉取最新代码（data/ 已排除在 git 之外，不会被覆盖）"
echo "=================================================="
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "!! 工作区有未提交的改动，先停下来人工确认，避免把服务器上的改动冲掉："
  git status --short
  exit 1
fi
git pull --ff-only

echo
echo "=================================================="
echo "[3/4] 重建并启动"
echo "=================================================="
docker compose up -d --build

echo
echo "=================================================="
echo "[4/4] 健康检查"
echo "=================================================="
sleep 4
docker compose ps || true
curl -fsS http://127.0.0.1:3000/api/health && echo || {
  echo "!! 健康检查失败，请查看日志：docker compose logs -f --tail=100"
  echo "!! 需要回滚数据时，把 $BACKUP_REL 里的 greensinbit.db 与 uploads 复制回 data/ 再重启"
  exit 1
}

echo
echo "更新完成。备份在：$BACKUP_REL"
echo "提示：定期把 data/backups 里的最新备份下载到本地，服务器整机故障时同一块盘上的备份也会一起丢。"
