# Deployment and Rollback Runbook

**Policy (BD-11.5):**
- Brief downtime is acceptable. There is one application stack and no blue/green.
- Migrations are additive (expand/contract), so the **previous** code always runs on the **new** schema.

**Pipeline:** `.github/workflows/ci.yml`, job `deploy`, runs on the self-hosted VPS runner after `test` passes on `main`.
It writes `docker/.env` from GitHub secrets, then runs `bash docker/deploy.sh`.

## What `docker/deploy.sh` does

| Step | Command (default) | On failure |
|---|---|---|
| 1. Backup | `pg_dump -U postgres clothing_brand \| gzip` → `~/backups/predeploy/predeploy-<sha>-<ts>.sql.gz` | stop; nothing changed |
| 2. Verify backup | file present, ≥ `MIN_BACKUP_BYTES` (1024), `gzip -t` passes | stop; nothing changed |
| 3. Build | `docker compose build api web` (old containers keep serving) | stop; old containers still serving |
| 4. Migrate | `docker compose run --rm api npx prisma migrate deploy`, **new** image, **before** switching | stop; old containers still serving (old code works on the expanded schema) |
| 5. Switch | `docker compose up -d api web` (brief downtime) | stop |
| 6. Readiness | poll `GET /health/ready` inside the api container every 3 s for up to **120 s**: PostgreSQL, Redis, outbox dispatcher | **fail the deploy** |
| 7. Proxy | `docker compose restart nginx` | fail |

- **Liveness vs readiness:** `GET /health` is liveness (the process is up). `GET /health/ready` is readiness (it can
  serve traffic). A process can be alive but not ready, for example with Redis down or the dispatcher not yet ticking.
- **Testing the script:** each step is a shell function. Tests replace them with stubs via
  `DEPLOY_HOOKS=<file>` (`apps/api/src/domain/identity/deploy-script.test.ts`).

## Rollback

1. **Code rollback (the normal case).** Re-run the deploy job for the previous good commit: revert on `main`, or
   re-run that commit's workflow.
   - No database change is needed: Phase 11's migration only **adds** a column, two tables and one partial index, and
     older code ignores them.
   - After rolling back past Phase 11, customers signed in with the new opaque refresh tokens must sign in again. Old
     code can't read those tokens.
   - The Phase 11 identity protections (verified-phone login, proof-before-claim, guest attachment rules) are absent
     until Phase 11 is redeployed.
2. **Data restore (only for data corruption).** Use the step-1 backup:
   `gunzip -c ~/backups/predeploy/predeploy-<sha>-<ts>.sql.gz | docker compose exec -T postgres psql -U postgres clothing_brand`
   into a freshly recreated database, following `docker/backup.sh`'s restore notes.
   **Every write made since the backup is lost.** Decide explicitly before doing it.
3. **Schema contraction** (dropping a column or table) is never part of a rollback. Any later contraction is its own,
   explicitly approved step.

## Operational checks after a deploy

- `GET /health/ready` → `{"ready":true,"checks":{"postgres":true,"redis":true,"outboxDispatcher":true}}`
- `GET /api/v1/ops/attention`, either signed in with `ops.read` or with `Authorization: Bearer $OPS_MONITOR_TOKEN`
  (set the token in `docker/.env` to enable the monitor path). Every `signals` value should be `0`; `needsAttention` is
  their sum.
- Logs are JSON lines on stdout. Each request line carries its `correlationId`, also returned as the `X-Correlation-Id`
  response header and stored on outbox rows.
