# Asif Zone Commerce Platform

One codebase that runs three separate stores: Asif Zone, Nasihamart and Tahafi. Each store is its own installation with its own database and content, and `STORE_THEME` (`default`, `nasihamart`, `tahafi`) selects its look.

## Project layout

| Path | What it holds |
|---|---|
| `apps/web` | Storefront and admin (Next.js 15, React 19, Tailwind 3, Framer Motion) |
| `apps/api` | Backend (Express, Prisma, Postgres, Vitest) |
| `packages/shared` | Code shared by web and api |
| `packages/ui-tokens` | Design tokens and per-store themes |
| `packages/config` | Shared TypeScript config |
| `docker` | Production compose file, nginx, deploy and backup scripts |
| `docs` | Documentation, see the [index](docs/README.md) |

Working rules for this repo are in [CLAUDE.md](CLAUDE.md).

## Local development

You need Node.js 20+, [pnpm](https://pnpm.io) and Docker Desktop.

1. Start Postgres and Redis:
   ```bash
   docker compose -f docker/docker-compose.yml up -d postgres redis
   ```
2. Copy the env files, then edit `apps/api/.env` if your DB or Redis ports differ:
   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   ```
3. Install dependencies and set up the database. The seed prints a generated admin login:
   ```bash
   pnpm install
   pnpm --filter api prisma:migrate
   pnpm --filter api db:seed
   ```
4. Run both apps with hot reload:
   ```bash
   pnpm dev
   ```

| Service | URL |
|---|---|
| Storefront | http://localhost:3000 |
| Admin | http://localhost:3000/admin/login |
| API | http://localhost:4000 |

## Tests

```bash
pnpm --filter api test        # Vitest API tests
pnpm --filter web lint
pnpm --filter web test:e2e    # Playwright, needs `pnpm dev` running
```

CI runs on every pull request (`.github/workflows/ci.yml`).

## Deployment

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): deploy and rollback runbook
- [docs/STORE_DEPLOYMENT.md](docs/STORE_DEPLOYMENT.md): how each store is deployed
- [docs/installations/](docs/installations/): per-store notes and adding a new store
