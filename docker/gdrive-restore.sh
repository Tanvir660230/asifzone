#!/usr/bin/env bash
# Google Drive ব্যাকআপ থেকে ডাটাবেস (আর চাইলে ছবি) ফেরত আনা — VPS-এ root হিসেবে চালাতে হবে।
#
#   bash docker/gdrive-restore.sh list               কোন কোন তারিখের ব্যাকআপ আছে
#   bash docker/gdrive-restore.sh 2026-10-04         ওই দিনের ডাটাবেস ফেরত আনা
#   bash docker/gdrive-restore.sh 2026-10 monthly    ওই মাসের মাসিক কপি থেকে
#   RESTORE_IMAGES=1 bash docker/gdrive-restore.sh 2026-10-04    সাথে সব ছবিও Drive থেকে ফেরত
#
# AR-06: encrypted ব্যাকআপ (database.sql.gz.age) খুলতে এই স্টোরের private key লাগে — primary বা recovery,
# যেকোনো একটা। key শুধু এই restore-এর জন্য আনুন, repository-র বাইরে রাখুন (chmod 600), কাজ শেষে মুছে ফেলুন:
#   BACKUP_AGE_IDENTITY=/root/restore-key.txt bash docker/gdrive-restore.sh 2026-10-04
#   EXPECT_SHA256=<last-backup.txt-এর sha256>   দিলে ফাইল খোলার আগে মিলিয়ে দেখা হয়
# পুরনো খোলা ব্যাকআপ (database.sql.gz) key ছাড়াই আগের মতো ফেরত আনা যায়।
# settings.env.age খুলতে: age -d -i <key> -o settings.env settings.env.age
#
# ফেরত আনার আগে বর্তমান ডাটাবেসের একটা কপি /var/backups/clothing-brand-এ রেখে দেওয়া হয়,
# তাই ভুল তারিখ বেছে নিলেও আগের অবস্থায় ফেরা যায়।
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${COMPOSE_PROJECT_NAME:-$(grep -E '^COMPOSE_PROJECT_NAME=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true)}"
PROJECT="${PROJECT:-docker}"
# Phase 12 (W10): the store's own backup destination — required, no store default (env or docker/.env).
REMOTE="${GDRIVE_REMOTE:-$(grep -E '^GDRIVE_REMOTE=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true)}"
[ -n "$REMOTE" ] || { echo "GDRIVE_REMOTE is not set (docker/.env) — refusing to guess another store's backup folder"; exit 1; }
POSTGRES_DB="${POSTGRES_DB:-$(grep -E '^POSTGRES_DB=' "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true)}"
POSTGRES_DB="${POSTGRES_DB:-clothing_brand}"
SAFETY_DIR="${BACKUP_DIR:-/var/backups/clothing-brand}"
dc() { docker compose -p "$PROJECT" -f "$COMPOSE_DIR/docker-compose.yml" --project-directory "$COMPOSE_DIR" "$@"; }

WHEN="${1:-}"
KIND="${2:-daily}"
if [ -z "$WHEN" ] || [ "$WHEN" = "list" ]; then
  echo "প্রতিদিনের ব্যাকআপ:"; rclone lsf "$REMOTE/daily" | sed 's#/$##'
  echo; echo "মাসিক ব্যাকআপ:"; rclone lsf "$REMOTE/monthly" | sed 's#/$##'
  exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FILES="$(rclone lsf "$REMOTE/$KIND/$WHEN/" 2>/dev/null || true)"
if grep -qx 'database.sql.gz.age' <<<"$FILES"; then
  IDENTITY="${BACKUP_AGE_IDENTITY:-}"
  [ -n "$IDENTITY" ] || { echo "$KIND/$WHEN encrypted — BACKUP_AGE_IDENTITY-এ এই স্টোরের private key-এর path দিন।"; exit 1; }
  [ -f "$IDENTITY" ] || { echo "BACKUP_AGE_IDENTITY ফাইল পাইনি: $IDENTITY"; exit 1; }
  IDENTITY_DIR="$(cd "$(dirname "$IDENTITY")" && pwd)"
  case "$IDENTITY_DIR/" in
    "$(dirname "$COMPOSE_DIR")"/*) echo "private key repository-র ভেতরে রাখা যাবে না — বাইরে সরিয়ে আবার চালান।"; exit 1 ;;
  esac
  [ "$(stat -c %a "$IDENTITY" 2>/dev/null)" = "600" ] || echo "সতর্কতা: $IDENTITY-এর permission 600 নয় (chmod 600 করুন)।"
  rclone copy "$REMOTE/$KIND/$WHEN/database.sql.gz.age" "$TMP" || { echo "ওই তারিখের ব্যাকআপ নামানো যায়নি: $KIND/$WHEN"; exit 1; }
  if [ -n "${EXPECT_SHA256:-}" ]; then
    [ "$(sha256sum "$TMP/database.sql.gz.age" | cut -d' ' -f1)" = "$EXPECT_SHA256" ] \
      || { echo "SHA-256 মেলেনি — ফাইলটা ব্যাকআপের সময়ের ফাইল নয়। ফেরত আনা বাতিল।"; exit 1; }
    echo "SHA-256 মিলেছে।"
  fi
  age -d -i "$IDENTITY" -o "$TMP/database.sql.gz" "$TMP/database.sql.gz.age" \
    || { echo "খোলা যায়নি — key-টা এই স্টোরের এই ব্যাকআপের নয়, বা passphrase ভুল।"; exit 1; }
elif grep -qx 'database.sql.gz' <<<"$FILES"; then
  rclone copy "$REMOTE/$KIND/$WHEN/database.sql.gz" "$TMP" || { echo "ওই তারিখের ব্যাকআপ নামানো যায়নি: $KIND/$WHEN"; exit 1; }
else
  echo "ওই তারিখের ব্যাকআপ পাইনি: $KIND/$WHEN"; exit 1
fi
gzip -t "$TMP/database.sql.gz"

echo "সতর্কতা: বর্তমান ডাটাবেস মুছে $KIND/$WHEN-এর ব্যাকআপ বসানো হবে।"
echo "ওই সময়ের পরে আসা অর্ডার/পরিবর্তন হারিয়ে যাবে (তবে বর্তমান অবস্থার একটা কপি আগে রেখে দেওয়া হবে)।"
read -rp "নিশ্চিত হলে ঠিক এভাবে লিখুন RESTORE: " ans
[ "$ans" = "RESTORE" ] || { echo "বাতিল করা হলো।"; exit 1; }

mkdir -p "$SAFETY_DIR"
SAFETY="$SAFETY_DIR/before-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
dc exec -T postgres pg_dump -U postgres --no-owner "$POSTGRES_DB" | gzip > "$SAFETY"
echo "বর্তমান ডাটাবেসের কপি রাখা হলো: $SAFETY"

dc stop api web
dc exec -T postgres dropdb -U postgres --force "$POSTGRES_DB"
dc exec -T postgres createdb -U postgres "$POSTGRES_DB"
gunzip -c "$TMP/database.sql.gz" | dc exec -T postgres psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q

if [ "${RESTORE_IMAGES:-0}" = "1" ]; then
  UPLOADS="$(docker volume inspect "${PROJECT}_uploads_data" --format '{{ .Mountpoint }}')"
  rclone copy "$REMOTE/images" "$UPLOADS"
  echo "ছবি ফেরত আনা হয়েছে।"
fi

dc up -d api web
dc restart nginx
echo "ফেরত আনা শেষ। মোট অর্ডার: $(dc exec -T postgres psql -U postgres -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "Order"')"
