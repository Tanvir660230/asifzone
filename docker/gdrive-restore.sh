#!/usr/bin/env bash
# Google Drive ব্যাকআপ থেকে ডাটাবেস (আর চাইলে ছবি) ফেরত আনা — VPS-এ root হিসেবে চালাতে হবে।
#
#   bash docker/gdrive-restore.sh list               কোন কোন তারিখের ব্যাকআপ আছে
#   bash docker/gdrive-restore.sh 2026-10-04         ওই দিনের ডাটাবেস ফেরত আনা
#   bash docker/gdrive-restore.sh 2026-10 monthly    ওই মাসের মাসিক কপি থেকে
#   RESTORE_IMAGES=1 bash docker/gdrive-restore.sh 2026-10-04    সাথে সব ছবিও Drive থেকে ফেরত
#
# ফেরত আনার আগে বর্তমান ডাটাবেসের একটা কপি /var/backups/clothing-brand-এ রেখে দেওয়া হয়,
# তাই ভুল তারিখ বেছে নিলেও আগের অবস্থায় ফেরা যায়।
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${COMPOSE_PROJECT_NAME:-$(grep -E '^COMPOSE_PROJECT_NAME=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true)}"
PROJECT="${PROJECT:-docker}"
REMOTE="${GDRIVE_REMOTE:-gdrive:asifzone-backups}"
dc() { docker compose -p "$PROJECT" -f "$COMPOSE_DIR/docker-compose.yml" --project-directory "$COMPOSE_DIR" "$@"; }

WHEN="${1:-}"
KIND="${2:-daily}"
if [ -z "$WHEN" ] || [ "$WHEN" = "list" ]; then
  echo "প্রতিদিনের ব্যাকআপ:"; rclone lsf "$REMOTE/daily" | sed 's#/$##'
  echo; echo "মাসিক ব্যাকআপ:"; rclone lsf "$REMOTE/monthly" | sed 's#/$##'
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
rclone copy "$REMOTE/$KIND/$WHEN/database.sql.gz" "$TMP" || { echo "ওই তারিখের ব্যাকআপ পাইনি: $KIND/$WHEN"; exit 1; }
gzip -t "$TMP/database.sql.gz"

echo "সতর্কতা: বর্তমান ডাটাবেস মুছে $KIND/$WHEN-এর ব্যাকআপ বসানো হবে।"
echo "ওই সময়ের পরে আসা অর্ডার/পরিবর্তন হারিয়ে যাবে (তবে বর্তমান অবস্থার একটা কপি আগে রেখে দেওয়া হবে)।"
read -rp "নিশ্চিত হলে ঠিক এভাবে লিখুন RESTORE: " ans
[ "$ans" = "RESTORE" ] || { echo "বাতিল করা হলো।"; exit 1; }

mkdir -p /var/backups/clothing-brand
SAFETY="/var/backups/clothing-brand/before-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
dc exec -T postgres pg_dump -U postgres --no-owner clothing_brand | gzip > "$SAFETY"
echo "বর্তমান ডাটাবেসের কপি রাখা হলো: $SAFETY"

dc stop api web
dc exec -T postgres dropdb -U postgres --force clothing_brand
dc exec -T postgres createdb -U postgres clothing_brand
gunzip -c "$TMP/database.sql.gz" | dc exec -T postgres psql -U postgres -d clothing_brand -v ON_ERROR_STOP=1 -q

if [ "${RESTORE_IMAGES:-0}" = "1" ]; then
  UPLOADS="$(docker volume inspect "${PROJECT}_uploads_data" --format '{{ .Mountpoint }}')"
  rclone copy "$REMOTE/images" "$UPLOADS"
  echo "ছবি ফেরত আনা হয়েছে।"
fi

dc up -d api web
dc restart nginx
echo "ফেরত আনা শেষ। মোট অর্ডার: $(dc exec -T postgres psql -U postgres -d clothing_brand -tAc 'SELECT count(*) FROM "Order"')"
