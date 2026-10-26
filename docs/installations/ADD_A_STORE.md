# Adding a store (a new installation)

Each store is this codebase running with its own `INSTALL_ID`, database, uploads, domain and theme. Nasihamart and Tahafi were added this way.

1. **Theme.** Add a `themeDefinitions` entry in `packages/ui-tokens/src/index.js` (palette, radii, fonts, component tokens, bands; see the Tahafi and Nasihamart entries). Add a contrast block to `apps/api/src/config/theme-tokens.test.ts`. New fonts go in `apps/web/app/layout.tsx` with `preload: false`.
2. **Preset (optional).** For a structural difference, follow `apps/web/components/storefront/presets/README.md`.
3. **Brand files.** Put them in `docs/brand/<id>/`: SVG masters, PNG exports, a generator, `THEME_BLUEPRINT.md`, `SECTIONS.md` and `CONTENT_CHECKLIST.md`.
4. **Sample store.** Add `apps/api/scripts/sample-store/<id>.fixture.ts` and register it in `load.ts`, so the theme can be reviewed locally with real-looking content.
5. **Runbook and script.** Copy `docs/installations/tahafi.md` and `tahafi-first-deploy.sh`. Change the id, domain, ports (+100 per store: 4300/3300 next), compose project, database and backup remote.
6. **CI.** Add a guarded "Deploy <store>" step to the deploy job in `.github/workflows/ci.yml`.
7. **Docs.** Add the theme to `docker/.env.example`, `docs/STORE_DEPLOYMENT.md`, the `docs/DESIGN_SYSTEM.md` table and `CLAUDE.md`.
8. **Check.** Every existing theme stays pixel-identical. Test the new one at 1440px and 375px, with 0 axe violations. Watch the server's memory (`free -m`) after it goes live.
