# Asif Zone — working rules

pnpm + turbo monorepo: `apps/web` (Next.js 15, React 19, Tailwind 3, Framer Motion), `apps/api` (Express + Prisma + Postgres, Vitest), `packages/ui-tokens` (design tokens). Read `docs/MASTER_SYSTEM_INVENTORY.md` for the platform map.

## Skill & tool workflow

Use the right skill at the right moment without being asked. Pick only what the task needs; a one-line fix does not need the full pipeline.

### Before writing code
| Situation | Use |
|---|---|
| Multi-step feature or anything touching several files | `writing-plans` |
| New page / section / component, or a redesign | `frontend-design` for direction, `ui-ux-pro-max` for palette, type, UX rules and patterns |
| Storefront landing / marketing / hero sections | add `design-taste-frontend` (anti-template layouts) |
| Bug, failing test, unexpected behaviour | `systematic-debugging` — find root cause before proposing a fix |
| Unsure about a library API (Next.js, Prisma, Framer Motion, Playwright…) | Context7 MCP for current docs instead of memory |
| API / domain logic change (pricing, inventory, payments, orders) | `test-driven-development` — write the failing Vitest test first |

### While writing code
- React / Next.js code: follow `vercel-react-best-practices` (server components, data fetching, bundle size, no waterfalls).
- Reusable components with growing boolean props: `vercel-composition-patterns`.
- UI work: `impeccable` is the hands-on design partner (shape, polish, animate, colorize, harden empty/error states).

### After writing code (before saying "done")
1. UI changed → `impeccable` critique/audit + `web-design-guidelines` review on the changed files, fix what they find.
2. UI changed → see it: start the app, open the page with Playwright MCP (or `webapp-testing`), screenshot desktop **and** mobile width, fix issues, repeat until it looks right. Check light theme only for admin.
3. Behaviour changed → run the relevant checks (`pnpm --filter api test`, `pnpm --filter web lint`, `pnpm --filter web test:e2e <spec>`).
4. `verification-before-completion` — never claim done/fixed/passing without the command output that proves it.
5. Bigger feature or before a PR → `requesting-code-review` / `/code-review`; auth, payments, checkout, uploads or public endpoints → also `/security-review`.

## Design rules (these override what any design skill suggests)
- The design system in `docs/DESIGN_SYSTEM.md` is the source of truth. Use the tokens in `packages/ui-tokens`, the recipes in `apps/web/app/globals.css`, the primitives in `apps/web/components/ui/*` and motion from `apps/web/lib/motion.ts`. Design skills provide taste and critique; implement their ideas through these tokens, never with hard-coded colours, fonts or one-off styles. Propose a token change instead of bypassing tokens.
- Admin: Apple-style, calm, light only (no dark mode).
- Storefront: per-brand theming via CSS variables (`STORE_THEME` / `data-brand`); never hard-code one brand's look.
- Asif Zone and Nasihamart are two installations of this one codebase (`STORE_THEME=default` / `nasihamart`, own DB and content). A shared component change ships to both; a brand-only look change goes in that theme's tokens (`themeDefinitions` in `packages/ui-tokens`), never `if (brand === …)`. New tokens default to Asif Zone's current look. Storefront changes: check both themes, and keep `default` pixel-identical unless the change is meant for it (docs/DESIGN_SYSTEM.md).
- Avoid AI-template tells: purple/blue gradients, emoji as icons, everything centred, identical 3-card grids, generic hero copy, gratuitous glassmorphism.
- Every UI must handle loading, empty and error states, and work at 375px width.
