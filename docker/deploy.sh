#!/usr/bin/env bash
# Phase 11 deployment (BD-11.5; docs/DEPLOYMENT.md). Brief downtime is accepted — no blue/green, one application stack.
#
#   1. backup      pg_dump of the live database (before anything changes)
#   2. verify      the backup exists, is not tiny, and is a valid gzip — otherwise stop (nothing changed yet)
#   3. build       new images while the old containers keep serving
#   4. migrate     `prisma migrate deploy` with the NEW image against the live DB — before any new code serves traffic.
#                  Migrations are additive (expand/contract), so the old code keeps working on the expanded schema.
#   5. switch      start the new api/web containers
#   6. readiness   poll /health/ready (PostgreSQL + Redis + outbox dispatcher) for up to READY_TIMEOUT seconds — fail otherwise
#   7. proxy       restart nginx so it never proxies to a dead container
#
# Every step is a function so tests (and emergencies) can replace it: DEPLOY_HOOKS=<file> is sourced after the defaults.
set -euo pipefail

COMPOSE="${COMPOSE:-docker compose -f docker/docker-compose.yml --env-file docker/.env}"
ENV_FILE="${ENV_FILE:-docker/.env}"
# Phase 12 (W10): per-store values come from docker/.env (a shell env var wins). POSTGRES_DB defaults to the original name.
env_value() { local v="${!1:-}"; [ -n "$v" ] || v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2-)"; printf '%s' "$v"; }
POSTGRES_DB="$(env_value POSTGRES_DB)"; POSTGRES_DB="${POSTGRES_DB:-clothing_brand}"
REQUIRED_STORE_VARS="${REQUIRED_STORE_VARS:-SERVER_NAME SERVER_ALIASES CERT_NAME GDRIVE_REMOTE}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/predeploy}"
READY_TIMEOUT="${READY_TIMEOUT:-120}"
READY_POLL="${READY_POLL:-3}"
MIN_BACKUP_BYTES="${MIN_BACKUP_BYTES:-1024}"
SHA="${DEPLOY_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
BACKUP_FILE="${BACKUP_FILE:-$BACKUP_DIR/predeploy-$SHA-$(date +%Y%m%d-%H%M%S).sql.gz}"

do_backup()        { $COMPOSE exec -T postgres pg_dump -U postgres "$POSTGRES_DB" | gzip > "$BACKUP_FILE"; }
do_build()         { $COMPOSE build api web; }
do_migrate()       { $COMPOSE run --rm api npx prisma migrate deploy; }
do_switch()        { $COMPOSE up -d api web; }
do_ready_probe()   { $COMPOSE exec -T api node -e "fetch('http://localhost:4000/health/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"; }
do_restart_proxy() { $COMPOSE restart nginx; }

if [ -n "${DEPLOY_HOOKS:-}" ]; then
  # shellcheck disable=SC1090
  source "$DEPLOY_HOOKS"
fi

fail() {
  echo "DEPLOY FAILED: $1" >&2
  echo "Rollback (docs/DEPLOYMENT.md): code — redeploy the previous commit (migrations are additive, so the old code runs on the" >&2
  echo "expanded schema); data — restore $BACKUP_FILE ONLY for data corruption (writes made since the backup are lost)." >&2
  exit 1
}

# 0. preflight — per-store configuration present (fails before anything is touched)
missing=""
for v in $REQUIRED_STORE_VARS; do [ -n "$(env_value "$v")" ] || missing="$missing $v"; done
[ -z "$missing" ] || fail "missing per-store configuration in $ENV_FILE:$missing (see docs/STORE_DEPLOYMENT.md) — nothing was changed"

mkdir -p "$(dirname "$BACKUP_FILE")"

echo "1/7 backup -> $BACKUP_FILE"
do_backup || fail "backup command failed — nothing was changed"

echo "2/7 verify backup"
[ -s "$BACKUP_FILE" ] || fail "backup file is missing or empty — nothing was changed"
size=$(wc -c < "$BACKUP_FILE" | tr -d ' ')
[ "$size" -ge "$MIN_BACKUP_BYTES" ] || fail "backup is only ${size} bytes (minimum ${MIN_BACKUP_BYTES}) — nothing was changed"
gzip -t "$BACKUP_FILE" || fail "backup is not a valid gzip archive — nothing was changed"

echo "3/7 build"
do_build || fail "image build failed — the old containers are still serving"

echo "4/7 migrate"
do_migrate || fail "migration failed — the old containers are still serving"

echo "5/7 switch"
do_switch || fail "starting the new containers failed"

echo "6/7 readiness (up to ${READY_TIMEOUT}s)"
deadline=$((SECONDS + READY_TIMEOUT))
until do_ready_probe; do
  if [ "$SECONDS" -ge "$deadline" ]; then fail "readiness did not become healthy within ${READY_TIMEOUT}s"; fi
  sleep "$READY_POLL"
done

echo "7/7 restart proxy"
do_restart_proxy || fail "nginx restart failed"

echo "DEPLOY OK ($SHA) — backup kept at $BACKUP_FILE"
