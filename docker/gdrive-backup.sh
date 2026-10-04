#!/usr/bin/env bash
# প্রতি রাতের Google Drive ব্যাকআপ — VPS-এর host-এ cron থেকে চলে (কন্টেইনারের ভেতরে না)।
# rclone-এ "gdrive" নামের remote আগে থেকে সেট থাকতে হবে (migrate-to-new-vps.sh-এর gdrive মোড এটা করে)।
#
# Drive-এ যেভাবে সাজানো থাকে:
#   asifzone-backups/
#     daily/2026-10-04/database.sql.gz      শেষ ৩০ দিন
#     monthly/2026-10/database.sql.gz       শেষ ১২ মাস (মাসের প্রথম ব্যাকআপ)
#     monthly/2026-10/settings.env          সাইটের secret সেটিংস — সার্ভার হারালে সাইট ফেরাতে লাগে
#     images/                               সব আপলোড করা ছবির হুবহু কপি
#     deleted-images/2026-10-04/            সাইট থেকে মোছা ছবি, ৩০ দিন রাখা হয়
#     last-backup.txt                       শেষ ব্যাকআপ কখন, সফল না ব্যর্থ
#
# এক কপি ডাটাবেস সার্ভারেও থাকে (/var/backups/clothing-brand, ৭ দিন)।
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
PROJECT="${COMPOSE_PROJECT_NAME:-$(grep -E '^COMPOSE_PROJECT_NAME=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true)}"
PROJECT="${PROJECT:-docker}"
REMOTE="${GDRIVE_REMOTE:-gdrive:asifzone-backups}"
LOCAL_DIR="${BACKUP_DIR:-/var/backups/clothing-brand}"
DAY="$(TZ=Asia/Dhaka date +%F)"
MONTH="$(TZ=Asia/Dhaka date +%Y-%m)"
STAMP="$(TZ=Asia/Dhaka date '+%Y-%m-%d %H:%M') (বাংলাদেশ সময়)"
TMP="$(mktemp -d)"

dc() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --project-directory "$COMPOSE_DIR" "$@"; }
status() { printf '%s\n' "$@" > "$TMP/last-backup.txt"; rclone copy "$TMP/last-backup.txt" "$REMOTE" --quiet || true; }
on_error() {
  status "FAILED — ব্যাকআপ ব্যর্থ হয়েছে" "সময়: $STAMP" "লাইন $1-এ সমস্যা। সার্ভারে লগ দেখুন: /var/log/asifzone-gdrive-backup.log"
}
trap 'on_error $LINENO' ERR
trap 'rm -rf "$TMP"' EXIT

echo "[$STAMP] ব্যাকআপ শুরু"

# ১. ডাটাবেস
dc exec -T postgres pg_dump -U postgres --no-owner clothing_brand | gzip -9 > "$TMP/database.sql.gz"
gzip -t "$TMP/database.sql.gz"
[ "$(stat -c %s "$TMP/database.sql.gz")" -gt 1000 ] || { echo "ডাটাবেস dump সন্দেহজনকভাবে ছোট"; false; }
DB_SIZE="$(du -h "$TMP/database.sql.gz" | cut -f1)"

mkdir -p "$LOCAL_DIR"
cp "$TMP/database.sql.gz" "$LOCAL_DIR/clothing_brand-$DAY.sql.gz"
find "$LOCAL_DIR" -name 'clothing_brand-*.sql.gz' -mtime +7 -delete

rclone copy "$TMP/database.sql.gz" "$REMOTE/daily/$DAY" --quiet

# ২. মাসিক কপি — মাসের প্রথম সফল ব্যাকআপটা রাখা হয়
if [ -z "$(rclone lsf "$REMOTE/monthly/$MONTH/" 2>/dev/null)" ]; then
  cp "$COMPOSE_DIR/.env" "$TMP/settings.env"
  rclone copy "$TMP/database.sql.gz" "$REMOTE/monthly/$MONTH" --quiet
  rclone copy "$TMP/settings.env" "$REMOTE/monthly/$MONTH" --quiet
fi

# ৩. ছবি — শুধু নতুন/বদলানো ফাইল যায়; মোছা ফাইল deleted-images-এ সরে যায়
UPLOADS="$(docker volume inspect "${PROJECT}_uploads_data" --format '{{ .Mountpoint }}')"
# admin প্যানেলের "Storage cleanup" যে ছবি ট্র্যাশে সরায় (.trash), সেগুলো images-এ রাখা হয় না — sync সেগুলোকে
# deleted-images/<দিন>-এ সরিয়ে দেয়, যেখানে আরও ৩০ দিন থাকে।
rclone sync "$UPLOADS" "$REMOTE/images" --exclude '.trash/**' --backup-dir "$REMOTE/deleted-images/$DAY" --quiet
IMG_COUNT="$(find "$UPLOADS" -path "$UPLOADS/.trash" -prune -o -type f -print | wc -l)"

# ৪. পুরনো ব্যাকআপ মোছা
rclone delete "$REMOTE/daily" --min-age 30d --quiet || true
rclone delete "$REMOTE/monthly" --min-age 365d --quiet || true
rclone delete "$REMOTE/deleted-images" --min-age 30d --quiet || true
rclone rmdirs "$REMOTE" --leave-root --quiet || true

ORDERS="$(dc exec -T postgres psql -U postgres -d clothing_brand -tAc 'SELECT count(*) FROM "Order"' 2>/dev/null || echo '?')"
status "OK — ব্যাকআপ সফল" "সময়: $STAMP" "ডাটাবেস: $DB_SIZE (মোট অর্ডার: $ORDERS)" "ছবি: $IMG_COUNT টি ফাইল"
echo "[$STAMP] ব্যাকআপ সফল — ডাটাবেস $DB_SIZE, ছবি $IMG_COUNT টি"
