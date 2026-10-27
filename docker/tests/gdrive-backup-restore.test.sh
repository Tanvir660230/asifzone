#!/usr/bin/env bash
# AR-06: local test of docker/gdrive-backup.sh and docker/gdrive-restore.sh with mock age, rclone and docker
# (pg_dump/psql run through `docker compose exec`, so the docker mock stands in for them).
# No real keys, no real Drive, no real database: the age mock does no cryptography, it only records which
# recipients a file was "encrypted" to and lets an identity file whose "# public key:" line matches decrypt it.
#
#   bash docker/tests/gdrive-backup-restore.test.sh
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# Format-valid but fake recipients ("age1" + 58 bech32 characters). Not real keys.
R1="age1$(printf 'q%.0s' $(seq 58))"
R2="age1$(printf 'p%.0s' $(seq 58))"
R3="age1$(printf 'z%.0s' $(seq 58))"
SECRET_MARKER="SECRET_MARKER_must_never_reach_the_remote"
DAY="$(TZ=Asia/Dhaka date +%F)"
MONTH="$(TZ=Asia/Dhaka date +%Y-%m)"

write_mocks() {
  local bin="$1"; mkdir -p "$bin"
  cat > "$bin/rclone" <<'EOF'
#!/usr/bin/env bash
# remote "fake:<path>" -> $FAKE_REMOTE_ROOT/<path>
echo "rclone $*" >> "$W/rclone.log"
map() { case "$1" in fake:*) echo "$FAKE_REMOTE_ROOT/${1#fake:}" ;; *) echo "$1" ;; esac; }
cmd="$1"; shift; args=()
while [ $# -gt 0 ]; do
  case "$1" in --quiet|--leave-root) ;; --exclude|--backup-dir|--min-age) shift ;; *) args+=("$1") ;; esac; shift
done
case "$cmd" in
  copy)
    s="$(map "${args[0]}")"; d="$(map "${args[1]}")"
    [ -e "$s" ] || { echo "rclone mock: not found: ${args[0]}" >&2; exit 3; }
    mkdir -p "$d"; if [ -d "$s" ]; then cp -r "$s"/. "$d"/; else cp "$s" "$d"/; fi ;;
  lsf)
    p="$(map "${args[0]}")"; [ -d "$p" ] || exit 3
    for f in "$p"/*; do [ -e "$f" ] || continue; if [ -d "$f" ]; then echo "$(basename "$f")/"; else basename "$f"; fi; done ;;
  sync)
    s="$(map "${args[0]}")"; d="$(map "${args[1]}")"; rm -rf "$d"; mkdir -p "$d"
    ( cd "$s" && find . -path ./.trash -prune -o -type f -print | while read -r f; do mkdir -p "$d/$(dirname "$f")"; cp "$f" "$d/$f"; done ) ;;
  delete|rmdirs) ;;
  *) echo "rclone mock: unsupported $cmd" >&2; exit 1 ;;
esac
EOF
  cat > "$bin/age" <<'EOF'
#!/usr/bin/env bash
# Mock age. Encrypt: header + one "-> MOCK <recipient>" line per -r + base64 payload. Decrypt: the identity's
# "# public key:" must be one of those recipients. Records arguments (public keys and paths only).
echo "age $*" >> "$W/age.log"
dec=0; out=""; ident=""; recips=()
while [ $# -gt 1 ]; do
  case "$1" in -d) dec=1 ;; -r) recips+=("$2"); shift ;; -o) out="$2"; shift ;; -i) ident="$2"; shift ;; *) break ;; esac; shift
done
[ "$1" = "-d" ] && { dec=1; shift; }
in="$1"
if [ "$dec" = 0 ]; then
  [ "${AGE_MOCK_FAIL:-0}" = 1 ] && { printf 'age-enc' > "$out"; echo "age mock: forced failure" >&2; exit 1; }
  [ "${AGE_MOCK_GARBAGE:-0}" = 1 ] && { printf 'garbage' > "$out"; exit 0; }
  { echo "age-encryption.org/v1"; for r in "${recips[@]}"; do echo "-> MOCK $r"; done; echo "---"; base64 < "$in"; } > "$out"
else
  pub="$(sed -n 's/^# public key: //p' "$ident")"
  grep -qx -- "-> MOCK $pub" "$in" || { echo "age mock: no identity matched any of the recipients" >&2; exit 1; }
  sed '1,/^---$/d' "$in" | base64 -d > "$out"
fi
EOF
  cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$W/docker.log"
if [ "$1" = "volume" ]; then echo "$W/uploads"; exit 0; fi
while [ $# -gt 0 ] && [ "$1" != "--project-directory" ]; do shift; done; shift 2
case "$1" in
  exec)
    shift 3   # exec -T postgres
    case "$1" in
      pg_dump) echo "-- MOCK DUMP"; for i in $(seq 1 3000); do echo "INSERT INTO \"Order\" VALUES ($i, 'order-$i-$((i*7919 % 1000))');"; done ;;
      psql) if [[ " $* " == *" -tAc "* ]]; then echo 42; else cat > "$W/restored.sql"; fi ;;
      dropdb|createdb) ;;
    esac ;;
  stop|up|restart) ;;
esac
EOF
  chmod +x "$bin"/*
}

# A fresh sandbox per case: copies of the two scripts in <W>/store/docker, a fake .env, uploads, remote root.
new_case() {
  W="$(mktemp -d)"; export W FAKE_REMOTE_ROOT="$W/remote"
  mkdir -p "$W/store/docker" "$W/remote" "$W/uploads/.trash" "$W/keys" "$W/local"
  cp "$SRC/gdrive-backup.sh" "$SRC/gdrive-restore.sh" "$W/store/docker/"
  : > "$W/store/docker/docker-compose.yml"
  printf 'COMPOSE_PROJECT_NAME=teststore\nGDRIVE_REMOTE=fake:store-backups\nJWT_ACCESS_SECRET=%s\n' "$SECRET_MARKER" > "$W/store/docker/.env"
  echo img1 > "$W/uploads/a.jpg"; echo img2 > "$W/uploads/b.jpg"; echo trashed > "$W/uploads/.trash/c.jpg"
  write_mocks "$W/bin"
  export PATH="$W/bin:$ORIG_PATH" BACKUP_DIR="$W/local"
  unset BACKUP_AGE_RECIPIENT_PRIMARY BACKUP_AGE_RECIPIENT_RECOVERY BACKUP_REQUIRE_TWO_RECIPIENTS AGE_MOCK_FAIL AGE_MOCK_GARBAGE BACKUP_AGE_IDENTITY EXPECT_SHA256
  # Safety: the mocks must shadow any real docker/rclone/age on this machine.
  for t in docker rclone age; do
    [ "$(command -v $t)" = "$W/bin/$t" ] || { echo "ABORT: $t does not resolve to the mock"; exit 2; }
  done
}
set_env() { printf '%s=%s\n' "$1" "$2" >> "$W/store/docker/.env"; }
run_backup() { bash "$W/store/docker/gdrive-backup.sh" > "$W/out.txt" 2>&1; echo $? > "$W/rc"; }
rc() { cat "$W/rc"; }
remote() { echo "$W/remote/store-backups/$1"; }
status_file() { cat "$(remote last-backup.txt)" 2>/dev/null; }
no_plaintext_on_remote() {
  ! find "$W/remote" -type f \( -name 'database.sql.gz' -o -name 'settings.env' \) | grep -q . &&
  ! grep -rqs "$SECRET_MARKER" "$W/remote" && ! grep -rqs "MOCK DUMP" "$W/remote"
}
identity() { printf '# created: test (mock identity, not a real key)\n# public key: %s\nAGE-SECRET-KEY-1MOCKONLYNOTAREALKEY\n' "$1" > "$2"; }
run_restore() { echo RESTORE | bash "$W/store/docker/gdrive-restore.sh" "$@" > "$W/rout.txt" 2>&1; echo $? > "$W/rrc"; }
rrc() { cat "$W/rrc"; }

ORIG_PATH="$PATH"

echo "1. No recipient set"
new_case; run_backup
check "exits non-zero" '[ "$(rc)" != 0 ]'
check "status FAILED uploaded" 'status_file | grep -q "^FAILED"'
check "pg_dump never ran" '! grep -q pg_dump "$W/docker.log" 2>/dev/null'
check "no daily/monthly upload" '[ ! -e "$(remote daily)" ] && [ ! -e "$(remote monthly)" ]'
check "no plaintext on remote" 'no_plaintext_on_remote'
rm -rf "$W"

echo "2. Malformed recipient"
new_case; set_env BACKUP_AGE_RECIPIENT_PRIMARY "age1notavalidkey"; run_backup
check "exits non-zero" '[ "$(rc)" != 0 ]'
check "status FAILED" 'status_file | grep -q "^FAILED"'
check "nothing uploaded" '[ ! -e "$(remote daily)" ]'
rm -rf "$W"

echo "3. Primary and recovery identical"
new_case; set_env BACKUP_AGE_RECIPIENT_PRIMARY "$R1"; set_env BACKUP_AGE_RECIPIENT_RECOVERY "$R1"; run_backup
check "exits non-zero" '[ "$(rc)" != 0 ]'
check "status FAILED" 'status_file | grep -q "^FAILED"'
check "nothing uploaded" '[ ! -e "$(remote daily)" ]'
rm -rf "$W"

echo "4. Strict two-recipient rule on, only primary set"
new_case; set_env BACKUP_AGE_RECIPIENT_PRIMARY "$R1"; set_env BACKUP_REQUIRE_TWO_RECIPIENTS 1; run_backup
check "exits non-zero" '[ "$(rc)" != 0 ]'
check "status FAILED" 'status_file | grep -q "^FAILED"'
check "nothing uploaded" '[ ! -e "$(remote daily)" ]'
rm -rf "$W"

echo "5. Strict rule off (default), only primary set"
new_case; set_env BACKUP_AGE_RECIPIENT_PRIMARY "$R1"; run_backup
check "exits 0" '[ "$(rc)" = 0 ]'
check "encrypted daily dump uploaded" '[ -f "$(remote daily/$DAY/database.sql.gz.age)" ]'
check "status OK with single-recipient warning" 'status_file | grep -q "^OK" && status_file | grep -q "শুধু একটা recipient"'
check "no plaintext on remote" 'no_plaintext_on_remote'
rm -rf "$W"

echo "6. Both recipients (normal run, then a second run in the same month)"
new_case; set_env BACKUP_AGE_RECIPIENT_PRIMARY "$R1"; set_env BACKUP_AGE_RECIPIENT_RECOVERY "$R2"; set_env BACKUP_REQUIRE_TWO_RECIPIENTS 1; run_backup
check "exits 0" '[ "$(rc)" = 0 ]'
check "daily database.sql.gz.age uploaded" '[ -f "$(remote daily/$DAY/database.sql.gz.age)" ]'
check "monthly database.sql.gz.age uploaded" '[ -f "$(remote monthly/$MONTH/database.sql.gz.age)" ]'
check "monthly settings.env.age uploaded" '[ -f "$(remote monthly/$MONTH/settings.env.age)" ]'
check "no plaintext dump, settings or secret on remote" 'no_plaintext_on_remote'
check "age called with both recipients for every file" '[ "$(grep -c -- "-r $R1 -r $R2" "$W/age.log")" = 2 ]'
check "dump encrypted to both recipients" 'grep -qx -- "-> MOCK $R1" "$(remote daily/$DAY/database.sql.gz.age)" && grep -qx -- "-> MOCK $R2" "$(remote daily/$DAY/database.sql.gz.age)"'
check "status OK lists both public keys" 'status_file | grep -q "^OK" && status_file | grep -q "primary key: $R1" && status_file | grep -q "recovery key: $R2"'
check "status SHA-256 matches the uploaded dump" 'status_file | grep -q "daily/$DAY/database.sql.gz.age sha256: $(sha256sum "$(remote daily/$DAY/database.sql.gz.age)" | cut -d" " -f1)"'
check "status SHA-256 matches the uploaded settings" 'status_file | grep -q "settings.env.age sha256: $(sha256sum "$(remote monthly/$MONTH/settings.env.age)" | cut -d" " -f1)"'
check "status holds no secret value" '! status_file | grep -q "$SECRET_MARKER"'
check "local server copy still written" '[ -f "$W/local/clothing_brand-$DAY.sql.gz" ]'
check "images synced, .trash excluded" '[ -f "$(remote images/a.jpg)" ] && [ ! -e "$(remote images/.trash/c.jpg)" ]'
SETTINGS_SHA_1="$(sha256sum "$(remote monthly/$MONTH/settings.env.age)" | cut -d' ' -f1)"
run_backup
check "second run exits 0" '[ "$(rc)" = 0 ]'
check "second run leaves the monthly settings untouched" '[ "$(sha256sum "$(remote monthly/$MONTH/settings.env.age)" | cut -d" " -f1)" = "$SETTINGS_SHA_1" ] && ! status_file | grep -q "settings.env.age sha256"'

echo "7. Restore from the encrypted backup of case 6"
DB_SHA="$(sha256sum "$(remote daily/$DAY/database.sql.gz.age)" | cut -d' ' -f1)"
run_restore "$DAY"
check "refuses without BACKUP_AGE_IDENTITY" '[ "$(rrc)" != 0 ] && grep -q BACKUP_AGE_IDENTITY "$W/rout.txt" && [ ! -e "$W/restored.sql" ]'
identity "$R1" "$W/store/key.txt"
BACKUP_AGE_IDENTITY="$W/store/key.txt" run_restore "$DAY"
check "refuses a key kept inside the repository" '[ "$(rrc)" != 0 ] && [ ! -e "$W/restored.sql" ]'
identity "$R3" "$W/keys/other-store.txt"
BACKUP_AGE_IDENTITY="$W/keys/other-store.txt" run_restore "$DAY"
check "another store's key cannot decrypt; database untouched" '[ "$(rrc)" != 0 ] && [ ! -e "$W/restored.sql" ] && ! grep -q dropdb "$W/docker.log"'
identity "$R1" "$W/keys/primary.txt"
BACKUP_AGE_IDENTITY="$W/keys/primary.txt" EXPECT_SHA256="0000" run_restore "$DAY"
check "refuses on SHA-256 mismatch" '[ "$(rrc)" != 0 ] && [ ! -e "$W/restored.sql" ]'
BACKUP_AGE_IDENTITY="$W/keys/primary.txt" EXPECT_SHA256="$DB_SHA" run_restore "$DAY"
check "primary key restores (SHA-256 checked)" '[ "$(rrc)" = 0 ] && grep -q "MOCK DUMP" "$W/restored.sql"'
rm -f "$W/restored.sql"
identity "$R2" "$W/keys/recovery.txt"
BACKUP_AGE_IDENTITY="$W/keys/recovery.txt" run_restore "$MONTH" monthly
check "recovery key restores the monthly copy" '[ "$(rrc)" = 0 ] && grep -q "MOCK DUMP" "$W/restored.sql"'
check "safety copy taken before restore" 'ls "$W/local"/before-restore-*.sql.gz >/dev/null 2>&1'
rm -rf "$W"

echo "8. Legacy plaintext backup still restores without a key"
new_case; mkdir -p "$(remote daily/2026-10-01)"
{ echo "-- MOCK DUMP legacy"; seq 1 500; } | gzip > "$(remote daily/2026-10-01/database.sql.gz)"
run_restore 2026-10-01
check "legacy restore works" '[ "$(rrc)" = 0 ] && grep -q "MOCK DUMP legacy" "$W/restored.sql"'
run_restore 2026-09-30
check "missing date refused" '[ "$(rrc)" != 0 ]'
rm -rf "$W"

echo "9. Encryption fails part-way"
new_case; set_env BACKUP_AGE_RECIPIENT_PRIMARY "$R1"; set_env BACKUP_AGE_RECIPIENT_RECOVERY "$R2"; export AGE_MOCK_FAIL=1; run_backup
check "exits non-zero" '[ "$(rc)" != 0 ]'
check "status FAILED" 'status_file | grep -q "^FAILED"'
check "partial file not uploaded" '[ ! -e "$(remote daily)" ] && [ ! -e "$(remote monthly)" ]'
rm -rf "$W"

echo "10. age exits 0 but writes a non-age file"
new_case; set_env BACKUP_AGE_RECIPIENT_PRIMARY "$R1"; set_env BACKUP_AGE_RECIPIENT_RECOVERY "$R2"; export AGE_MOCK_GARBAGE=1; run_backup
check "exits non-zero" '[ "$(rc)" != 0 ]'
check "status FAILED" 'status_file | grep -q "^FAILED"'
check "nothing uploaded" '[ ! -e "$(remote daily)" ]'
rm -rf "$W"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
