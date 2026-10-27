#!/usr/bin/env bash
# প্রতি রাতের Google Drive ব্যাকআপ — VPS-এর host-এ cron থেকে চলে (কন্টেইনারের ভেতরে না)।
# rclone-এ "gdrive" নামের remote আগে থেকে সেট থাকতে হবে (migrate-to-new-vps.sh-এর gdrive মোড এটা করে)।
#
# Drive-এ যেভাবে সাজানো থাকে:
#   <GDRIVE_REMOTE>/   (e.g. gdrive:<store>-backups)
#     daily/2026-10-04/database.sql.gz.age      শেষ ৩০ দিন (encrypted)
#     monthly/2026-10/database.sql.gz.age       শেষ ১২ মাস (মাসের প্রথম ব্যাকআপ, encrypted)
#     monthly/2026-10/settings.env.age          সাইটের secret সেটিংস, encrypted — সার্ভার হারালে সাইট ফেরাতে লাগে
#     images/                                   সব আপলোড করা ছবির হুবহু কপি
#     deleted-images/2026-10-04/                সাইট থেকে মোছা ছবি, ৩০ দিন রাখা হয়
#     last-backup.txt                           শেষ ব্যাকআপ কখন, সফল না ব্যর্থ, কোন key, SHA-256
#
# AR-06: ডাটাবেস আর settings আপলোডের আগে age দিয়ে এই স্টোরের public key-তে encrypt হয়। private key সার্ভারে
# কখনো থাকে না। docker/.env (বা env)-এ:
#   BACKUP_AGE_RECIPIENT_PRIMARY=age1…    primary key-এর public অংশ
#   BACKUP_AGE_RECIPIENT_RECOVERY=age1…   offline recovery key-এর public অংশ
#   BACKUP_REQUIRE_TWO_RECIPIENTS=1       দুটোই না থাকলে ব্যাকআপ ব্যর্থ (D3-3) — ব্যর্থতার সতর্কবার্তা যাচাই
#                                         হওয়ার পরেই চালু করবেন (D3-4)
# একটাও recipient না থাকলে কিছুই আপলোড হয় না, FAILED লেখা হয় — খোলা (plaintext) ব্যাকআপে ফিরে যাওয়ার পথ নেই।
#
# এক কপি ডাটাবেস সার্ভারেও থাকে (/var/backups/clothing-brand, ৭ দিন)।
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"
env_value() { grep -E "^$1=" "$COMPOSE_DIR/.env" 2>/dev/null | cut -d= -f2- || true; }
PROJECT="${COMPOSE_PROJECT_NAME:-$(env_value COMPOSE_PROJECT_NAME)}"
PROJECT="${PROJECT:-docker}"
# Phase 12 (W10): the store's own backup destination — required, no store default (env or docker/.env).
REMOTE="${GDRIVE_REMOTE:-$(env_value GDRIVE_REMOTE)}"
[ -n "$REMOTE" ] || { echo "GDRIVE_REMOTE is not set (docker/.env) — refusing to guess another store's backup folder"; exit 1; }
POSTGRES_DB="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"
POSTGRES_DB="${POSTGRES_DB:-clothing_brand}"
# AR-06: this store's own recipients only — no default, never another store's key.
RECIPIENT_PRIMARY="${BACKUP_AGE_RECIPIENT_PRIMARY:-$(env_value BACKUP_AGE_RECIPIENT_PRIMARY)}"
RECIPIENT_RECOVERY="${BACKUP_AGE_RECIPIENT_RECOVERY:-$(env_value BACKUP_AGE_RECIPIENT_RECOVERY)}"
REQUIRE_TWO="${BACKUP_REQUIRE_TWO_RECIPIENTS:-$(env_value BACKUP_REQUIRE_TWO_RECIPIENTS)}"
LOCAL_DIR="${BACKUP_DIR:-/var/backups/clothing-brand}"
DAY="$(TZ=Asia/Dhaka date +%F)"
MONTH="$(TZ=Asia/Dhaka date +%Y-%m)"
STAMP="$(TZ=Asia/Dhaka date '+%Y-%m-%d %H:%M') (বাংলাদেশ সময়)"
TMP="$(mktemp -d)"

dc() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --project-directory "$COMPOSE_DIR" "$@"; }
status() { printf '%s\n' "$@" > "$TMP/last-backup.txt"; rclone copy "$TMP/last-backup.txt" "$REMOTE" --quiet || true; }
on_error() {
  status "FAILED — ব্যাকআপ ব্যর্থ হয়েছে" "সময়: $STAMP" "লাইন $1-এ সমস্যা। সার্ভারে cron লগ দেখুন।"
}
fail() {
  trap - ERR
  echo "[$STAMP] ব্যাকআপ ব্যর্থ — $1"
  status "FAILED — ব্যাকআপ ব্যর্থ হয়েছে" "সময়: $STAMP" "$1"
  exit 1
}
trap 'on_error $LINENO' ERR
trap 'rm -rf "$TMP"' EXIT

echo "[$STAMP] ব্যাকআপ শুরু"

# ০. encryption-এর key — ডাটাবেস dump করার আগেই যাচাই, যাতে ভুল config-এ খোলা ফাইল তৈরিই না হয়।
# X25519 recipient: "age1" + 58 bech32 অক্ষর।
valid_recipient() { [[ "$1" =~ ^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$ ]]; }
RECIPIENTS=()
for r in "$RECIPIENT_PRIMARY" "$RECIPIENT_RECOVERY"; do
  [ -n "$r" ] || continue
  valid_recipient "$r" || fail "BACKUP_AGE_RECIPIENT_* সঠিক age public key নয় — কিছু আপলোড হয়নি।"
  RECIPIENTS+=("$r")
done
[ "${#RECIPIENTS[@]}" -gt 0 ] || fail "BACKUP_AGE_RECIPIENT_PRIMARY/RECOVERY সেট নেই — encrypt ছাড়া কিছু আপলোড হয় না।"
if [ "${#RECIPIENTS[@]}" -eq 2 ] && [ "${RECIPIENTS[0]}" = "${RECIPIENTS[1]}" ]; then
  fail "primary আর recovery recipient একই — দুটো আলাদা key লাগবে।"
fi
if [ "$REQUIRE_TWO" = "1" ] && [ "${#RECIPIENTS[@]}" -ne 2 ]; then
  fail "BACKUP_REQUIRE_TWO_RECIPIENTS=1, কিন্তু দুটো recipient সেট নেই — কিছু আপলোড হয়নি।"
fi
AGE_ARGS=()
for r in "${RECIPIENTS[@]}"; do AGE_ARGS+=(-r "$r"); done
# age-এর ফাইল এই লাইন দিয়ে শুরু হয়; মাঝপথে থেমে যাওয়া বা ফাঁকা ফাইল আপলোড হয় না।
encrypt() {
  age "${AGE_ARGS[@]}" -o "$2" "$1" || fail "$(basename "$1") encrypt করা যায়নি — কিছু আপলোড হয়নি।"
  [ "$(head -c 21 "$2" 2>/dev/null)" = "age-encryption.org/v1" ] || fail "$(basename "$2") সঠিক age ফাইল নয় — আপলোড হয়নি।"
}
sha() { sha256sum "$1" | cut -d' ' -f1; }

# ১. ডাটাবেস
dc exec -T postgres pg_dump -U postgres --no-owner "$POSTGRES_DB" | gzip -9 > "$TMP/database.sql.gz"
gzip -t "$TMP/database.sql.gz"
[ "$(stat -c %s "$TMP/database.sql.gz")" -gt 1000 ] || { echo "ডাটাবেস dump সন্দেহজনকভাবে ছোট"; false; }
DB_SIZE="$(du -h "$TMP/database.sql.gz" | cut -f1)"

mkdir -p "$LOCAL_DIR"
cp "$TMP/database.sql.gz" "$LOCAL_DIR/$POSTGRES_DB-$DAY.sql.gz"
find "$LOCAL_DIR" -name "$POSTGRES_DB-*.sql.gz" -mtime +7 -delete

encrypt "$TMP/database.sql.gz" "$TMP/database.sql.gz.age"
rm -f "$TMP/database.sql.gz"
DB_SHA="$(sha "$TMP/database.sql.gz.age")"
rclone copy "$TMP/database.sql.gz.age" "$REMOTE/daily/$DAY" --quiet

# ২. মাসিক কপি — মাসের প্রথম সফল ব্যাকআপটা রাখা হয়। settings সরাসরি .env থেকে encrypt হয়; খোলা কপি কোথাও লেখা হয় না।
SETTINGS_SHA=""
if [ -z "$(rclone lsf "$REMOTE/monthly/$MONTH/" 2>/dev/null)" ]; then
  encrypt "$COMPOSE_DIR/.env" "$TMP/settings.env.age"
  SETTINGS_SHA="$(sha "$TMP/settings.env.age")"
  rclone copy "$TMP/database.sql.gz.age" "$REMOTE/monthly/$MONTH" --quiet
  rclone copy "$TMP/settings.env.age" "$REMOTE/monthly/$MONTH" --quiet
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

ORDERS="$(dc exec -T postgres psql -U postgres -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "Order"' 2>/dev/null || echo '?')"
# D3-8: শুধু public key আর ফাইলের SHA-256 — কোনো private key বা secret মান নয়।
KEY_LINES=("primary key: ${RECIPIENT_PRIMARY:-নেই}" "recovery key: ${RECIPIENT_RECOVERY:-নেই}")
[ "${#RECIPIENTS[@]}" -eq 2 ] || KEY_LINES+=("সতর্কতা: শুধু একটা recipient — অন্য key দিয়ে খোলা যাবে না")
SHA_LINES=("daily/$DAY/database.sql.gz.age sha256: $DB_SHA")
[ -z "$SETTINGS_SHA" ] || SHA_LINES+=("monthly/$MONTH/database.sql.gz.age sha256: $DB_SHA" "monthly/$MONTH/settings.env.age sha256: $SETTINGS_SHA")
status "OK — ব্যাকআপ সফল" "সময়: $STAMP" "ডাটাবেস: $DB_SIZE (মোট অর্ডার: $ORDERS)" "ছবি: $IMG_COUNT টি ফাইল" "${KEY_LINES[@]}" "${SHA_LINES[@]}"
printf '%s\n' "${KEY_LINES[@]}" "${SHA_LINES[@]}"
echo "[$STAMP] ব্যাকআপ সফল — ডাটাবেস $DB_SIZE, ছবি $IMG_COUNT টি"
