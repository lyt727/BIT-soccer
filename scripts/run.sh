#!/usr/bin/env bash
# =============================================================
# 服务器上跑维护脚本（服务器没装 Node，用容器里的 Node 跑）
#
# 用法（在仓库根目录）：
#   bash scripts/run.sh migration        升级不动数据验证（部署前跑）
#   bash scripts/run.sh security         线上体检（默认密码 / 验证码模式 / 备份 / 照片）
#   bash scripts/run.sh backup           备份数据库 + 学生卡照片
#   bash scripts/run.sh roles            验证「按手机号认证管理员」不会动到已有账号
#   bash scripts/run.sh sms [手机号]      短信配置自检（带手机号则真发一条）
#
# 这些命令都是只读或只写 data/backups，不会动到已有的报名数据。
# 如果提示镜像不存在，先执行一次：docker compose build
# =============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

CMD="${1:-}"
shift || true

IMAGE="greensinbit:latest"
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "找不到镜像 $IMAGE，请先执行：docker compose build"
  exit 1
}

# 把当前目录挂进容器，这样跑的是你刚 pull 下来的代码（不用等重新构建镜像）。
#
# 关键：主机上的数据在 <仓库根>/data，而 compose 会把它挂成容器里的 /app/server/data。
# 这里没走 compose，所以必须手动告诉脚本数据在哪，否则它会按容器习惯去找
# /app/server/data/greensinbit.db —— 那里是空的，就会报「找不到数据库文件」。
DATA_DIR="$PWD/data"

# 先确认数据确实在这里，避免把脚本指到空目录去（脚本本身只读，但早点报错更清楚）
if [ ! -f "$DATA_DIR/greensinbit.db" ]; then
  echo "在 $DATA_DIR 里没找到 greensinbit.db。"
  echo "请确认你是在仓库根目录执行这个脚本（目录名一般是 greensinbit）："
  echo "  cd ~/greensinbit && bash scripts/run.sh $CMD"
  echo "当前目录：$PWD"
  ls -la "$DATA_DIR" 2>/dev/null || echo "（$DATA_DIR 不存在）"
  exit 1
fi

run_in_container() {
  # 把 .env 一起带进去：短信开关、AI 密钥这些配置和线上服务保持一致；
  # 下面 -e 指定的数据路径优先级更高，会把 .env 里可能存在的同名项覆盖掉。
  local envArgs=()
  if [ -f "$PWD/.env" ]; then envArgs=(--env-file "$PWD/.env"); fi
  exec docker run --rm \
    -v "$PWD:/app" -w /app \
    "${envArgs[@]}" \
    -e DB_FILE=/app/data/greensinbit.db \
    -e UPLOAD_DIR=/app/data/uploads \
    -e BACKUP_DIR=/app/data/backups \
    "$IMAGE" node "$@"
}

case "$CMD" in
  migration) run_in_container scripts/test-migration.mjs "$@" ;;
  security)  run_in_container scripts/security-check.mjs "$@" ;;
  backup)    run_in_container scripts/backup-db.mjs "$@" ;;
  roles)     run_in_container scripts/test-role-sync.mjs "$@" ;;
  sms)       run_in_container scripts/test-sms.mjs "$@" ;;
  *)
    echo "用法：bash scripts/run.sh {migration|security|backup|roles|sms} [参数...]"
    echo "  migration  升级不动数据验证（部署前跑，约 3 秒）"
    echo "  security   线上体检"
    echo "  backup     备份数据库与学生卡照片"
    echo "  roles      验证按手机号认证管理员不会动到已有账号"
    echo "  sms        短信配置自检（加手机号则真发一条测试短信）"
    exit 1
    ;;
esac
