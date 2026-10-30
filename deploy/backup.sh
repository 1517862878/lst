#!/usr/bin/env bash
# ============================================================================
# 工科影展：PostgreSQL 备份 + 轮转
#
#   sudo -u postgres bash deploy/backup.sh
#
# 放进 crontab（每日 03:30）：
#   30 3 * * * /usr/bin/env bash /srv/gongke/deploy/backup.sh >> /var/log/gongke-backup.log 2>&1
#
# 环境变量：
#   PGDATABASE   默认 gongke
#   BACKUP_DIR   默认 /srv/gongke/backups
#   KEEP         保留份数，默认 14
#   PGPASSWORD   若不用 .pgpass 则需要
# ============================================================================
set -euo pipefail

DB="${PGDATABASE:-gongke}"
BACKUP_DIR="${BACKUP_DIR:-/srv/gongke/backups}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/$DB-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] 开始备份 $DB → $TARGET"
# -Fc：自定义格式，支持 pg_restore 选择性恢复；含 RLS 策略与函数体
pg_dump --format=custom --no-owner --file="$TARGET" "$DB"

# 立刻验证这份备份能被读取（写好但读不出的备份等于没有备份）
pg_restore --list "$TARGET" >/dev/null
size="$(du -h "$TARGET" | cut -f1)"
echo "[$(date -Is)] 备份完成，大小 $size，校验通过"

# 轮转：只保留最近 KEEP 份
mapfile -t old < <(ls -1t "$BACKUP_DIR/$DB"-*.dump 2>/dev/null | tail -n +$((KEEP + 1)))
if ((${#old[@]} > 0)); then
  printf '删除过期备份：%s\n' "${old[@]}"
  rm -f "${old[@]}"
fi

echo "[$(date -Is)] 当前保留：$(ls -1 "$BACKUP_DIR/$DB"-*.dump 2>/dev/null | wc -l) 份"

# 异地容灾（可选，按需启用）：
#   rclone copy "$TARGET" oss:gongke-backup/   # 阿里云 OSS
# 只做本机备份的机器，磁盘坏掉时备份与数据一起没了 —— 上生产前请至少接一个异地目标。
