# Tahafi installation

Tahafi (tahafi.com) is the third installation of this codebase, after Asif Zone and Nasihamart. It has its own database, catalog, admin and domain, and runs the same commit as the other two. Its look comes from `STORE_THEME=tahafi` (packages/ui-tokens `themeDefinitions.tahafi`, layout preset `tahafi`); see [docs/brand/tahafi/THEME_BLUEPRINT.md](../brand/tahafi/THEME_BLUEPRINT.md).

## Server settings (`/opt/tahafi/docker/.env`)

Written by `tahafi-first-deploy.sh stack` with fresh secrets. The server copy is the source of truth; CI never rewrites it.

| Key | Value |
|---|---|
| `INSTALL_ID` | `tahafi` — never change it on a live store (docs/STORE_DEPLOYMENT.md) |
| `STORE_THEME` | `tahafi` |
| `COMPOSE_PROJECT_NAME` | `tahafi` (volumes `tahafi_postgres_data`, `tahafi_redis_data`, `tahafi_uploads_data`) |
| `POSTGRES_DB` | `tahafi` |
| `API_HOST_PORT` / `WEB_HOST_PORT` | `4200` / `3200`, bound to the gateway of Asif Zone's `docker_default` network (`HOST_BIND_IP`) — reachable by Asif Zone's nginx, not by the internet |
| `SERVER_NAME` / `SERVER_ALIASES` / `CERT_NAME` | `tahafi.com` / `www.tahafi.com` / `tahafi.com` |
| `GDRIVE_REMOTE` | `gdrive:tahafi-backups` |

## First deployment

On the VPS as root:

```bash
git clone https://github.com/Tanvir660230/asifzone.git /opt/tahafi
cd /opt/tahafi
bash docs/installations/tahafi-first-deploy.sh stack <owner-email>   # login details → /root/tahafi-owner.txt
bash docs/installations/tahafi-first-deploy.sh check
# DNS: tahafi.com and www.tahafi.com A records → 187.77.137.12 (Hostinger). Not before the stack answers: Asif Zone's
# nginx sends unknown hosts to asifzone.com, which would show the wrong store.
bash docs/installations/tahafi-first-deploy.sh live <cert-email>
```

Then the nightly backup, like the other stores:

```bash
( crontab -l; echo '45 21 * * * cd /opt/tahafi && bash docker/gdrive-backup.sh >> /var/log/tahafi-gdrive-backup.log 2>&1' ) | crontab -
```

After the first deployment, every merge to `main` deploys Tahafi too (`.github/workflows/ci.yml`, "Deploy Tahafi"; skipped while `/opt/tahafi` does not exist).

## Memory

The VPS has 1 CPU and about 3.8 GB of RAM and has run out of memory before with two stores. Each store adds an API, a web server, Postgres and Redis. Watch `free -m` and `docker stats` after the first deployment; deployments run one store at a time. If memory stays tight, add swap or move one store to its own server (docs/installations/MOVE_TO_NEW_VPS.md).

## Content the owner enters (Admin → …)

- Settings → Store & branding: logo `docs/brand/tahafi/png/tahafi-logo.png`, logo on dark `tahafi-logo-on-dark.png`, favicon `tahafi-favicon-512.png`, social image `tahafi-og-image-1200x630.png`.
- Settings: contact email and phone, WhatsApp, delivery charges, return policy, SEO title and description.
- Catalog and homepage: see [docs/brand/tahafi/SECTIONS.md](../brand/tahafi/SECTIONS.md) and [CONTENT_CHECKLIST.md](../brand/tahafi/CONTENT_CHECKLIST.md). The hero's small line ("Utility Jacket | Olive cotton twill | ৳2,950") becomes the hang-tag.

## Local preview

```bash
cd apps/api && npx tsx scripts/sample-store/load.ts tahafi --replace   # local database only
STORE_THEME=tahafi pnpm --filter web dev
```
