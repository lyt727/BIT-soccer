#!/usr/bin/env bash
# =============================================================
# 服务器上跑维护脚本（服务器没装 Node，用容器里的 Node 跑）
#
# 用法（在仓库根目录）：
#   bash scripts/run.sh migration        升级不动数据验证（部署前跑）
#   bash scripts/run.sh security         线上体检（默认密码 / 验证码模式 / 备份 / 照片）
#   bash scripts/run.sh backup           备份数据库 + 学生卡照片
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

# 把当前目录挂进容器，这样跑的是你刚 pull 下来的代码（不用等重新构建镜像）
run_in_container() {
  exec docker run --rm -v "$PWD:/app" -w /app "$IMAGE" node "$@"
}

case "$CMD" in
  migration) run_in_container scripts/test-migration.mjs "$@" ;;
  security)  run_in_container scripts/security-check.mjs "$@" ;;
  backup)    run_in_container scripts/backup-db.mjs "$@" ;;
  *)
    echo "用法：bash scripts/run.sh {migration|security|backup} [参数...]"
    echo "  migration  升级不动数据验证（部署前跑，约 3 秒）"
    echo "  security   线上体检"
    echo "  backup     备份数据库与学生卡照片"
    exit 1
    ;;
esac
