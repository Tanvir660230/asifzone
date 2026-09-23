# Product Builder — final report

Covers the "Flexible Smart Product Builder" brief, delivered as seven stacked pull requests (P7–P13) on top of the product-management work in `product-management-report.md`. Everything below was run in this repository's dev environment; anything not run is listed as not verified.

## 1. Audit: what existed before

Three read-only audits (data model, admin UI and media, storefront / preview / cache) found that the backend already did most of what the brief calls "flexible":

- Product types, templates and attributes were data, not code. Size and colour were each optional per template (0, 1 or 2 variant dimensions).
- A size guide, care, material, FAQ and related products could already be switched on or off per product (`ProductSection.enabled`: inherit / on / off).
- Publishing was already blocked on missing required data, using one shared completeness check on client and server.

The gaps were almost all in the admin editor, plus three in the backend:

| Gap | Where |
|---|---|
| The editor was one long tabbed form, not a guided flow | admin UI |
| Preview opened in a new tab and showed only saved data, at one width, as a product page only | admin UI |
| No autosave and no draft recovery | admin UI |
| Changing a published product's URL left the old URL dead (no redirect) | API |
| An explicit slug change had no uniqueness check (a duplicate failed late with a database error) | API |
| Storefront pages only refreshed on a 60-second timer | API + storefront |
| Completeness could say "not applicable" for a size guide, but not for material or care | shared |

## 2. What changed, by pull request

| PR | Branch | What it does |
|---|---|---|
| #11 P7 | `feat/pim-p7-wizard-foundation` | Material and care count as "not applicable" when the product has them switched off. One shared function decides which wizard steps a product needs (`computeWizardSteps`). The spec-group builder moved to `packages/shared` so the preview can use it. |
| #12 P8 | `feat/pim-p8-redirects` | A published product whose slug changes gets a 301 from the old URL, with chains collapsed (A→B→C becomes A→C and B→C) and no redirect-to-itself. An explicit slug that another product already uses is refused with a clear 409. |
| #13 P9 | `feat/pim-p9-revalidation` | Every product change tells the storefront to drop exactly the cached pages it affects (`/api/revalidate`, protected by `REVALIDATE_SECRET`). If the secret isn't set, behaviour is unchanged (60-second refresh). |
| #14 P10 | `feat/pim-p10-wizard-shell` | The step-by-step builder: Basics, Media, Pricing, Options & Variants, Content, Care & Material, Size Guide, SEO, Preview, Final Review, Publish. Steps a product doesn't need don't appear at all. The draft is created once Basics/Pricing are done, then saved automatically 0.9 s after each change. |
| #15 P11 | `feat/pim-p11-live-preview` | A live preview beside the form, fed from what is typed (not from the last save). It renders at real desktop, tablet and mobile widths, in five views: product page, listing card, search result, social share card, Google result. It uses the storefront's own components; the live product page's HTML was checked byte-identical before and after the split. |
| #16 P12 | `feat/pim-p12-variants-uploads` | Bulk stock/price edits for variants; duplicate SKUs highlighted as you type and refused by the API; "Generate missing SKUs". Uploads show progress, run one at a time, and a failed file can be retried without losing the others. |
| #17 P13 | `feat/pim-p13-final-review` | Final Review and Publish steps, the URL-change confirmation, recovery of unsaved new drafts, simple-product SKU/stock, type-change explanation, history in the builder, cutover, and the test matrix. Details in section 3. |

## 3. P13 in detail

- **Final Review** lists every check that applies to this product, each with a **Fix** button that jumps to the step that fixes it. Checks that don't apply (e.g. care on a fragrance with care switched off) are not shown at all, not shown as passed or failed.
- **Publish** has three states: ready (Publish / Save draft), blocked (numbered list of what's missing, each with Fix; Publish disabled), and live (View product / Continue editing / Unpublish).
- **Changing a live product's URL is now a deliberate action.** Typing a new slug on a published product shows a notice with the current and new URL and two buttons, "Change URL" and "Keep current URL". Autosave never sends the slug of a published product, so a half-typed slug can't create a stream of redirects.
- **Old URLs redirect as soon as the change is saved.** When a slug isn't found, the product page now checks the redirect list itself, cached under the same tag the API refreshes on a rename, and sends a permanent redirect. Before this, the storefront's general redirect check re-reads its list only every 5 minutes, so an old URL could 404 for up to 5 minutes after a rename.
- **Draft recovery.** An unsaved new product (before the draft exists) is kept in the browser. After a refresh, a banner offers "Continue" (restores the fields and the step you were on) or "Start fresh". A saved product reopens on the step in the URL (`?step=`).
- **Simple products** (no size, no colour) now have SKU and Stock fields in Pricing. Before, a simple product had no way to set its stock in the builder.
- **Changing the product type** explains the effect before anything is saved: which filled fields will be kept but hidden, which options every variant now needs, which options no longer apply, and what the new type requires. Switching back restores the hidden values.
- **History** is available inside the builder.
- **Cutover.** "Add product" and every "edit product" link in the admin (product list, dashboards, BI pages, low-stock and slow-moving tables, duplicate dialog, the storefront's "Back to editor") now open the builder. **Deviation from the plan:** the old tabbed editor was kept, not removed, and is linked as "Classic editor" from the list and the builder. It shares the same form state and validation (`useProductFormState`), so the two can't disagree. It can be deleted later in one small change once the builder has been used for real.

## 4. Database, API and configuration changes

- **No schema changes and no migrations** in P7–P13.
- API: `upsertSlugRedirect` (redirects), the slug uniqueness check, revalidation calls after every product change, and duplicate-SKU refusal on create/update. No new endpoints except the storefront's `/api/revalidate`.
- New environment variables, both optional (see section 10): `REVALIDATE_SECRET` (API and web, must match) and `WEB_INTERNAL_URL` (API → web, e.g. `http://web:3000` in Docker).
- Permissions are unchanged: staff can create, edit and publish products; AI generation, CSV import, permanent delete and catalog settings stay owner-only, enforced by the API (not just hidden).

## 5. Tests performed

- **API unit + integration tests** (vitest, real Postgres): everything from before, plus new tests for na completeness, wizard steps, spec groups, redirect creation and chain collapsing, slug uniqueness, revalidation tags and call sites, and duplicate SKUs.
- **Browser tests** (Playwright, desktop and mobile), new in this program: `admin-product-wizard`, `admin-product-preview`, `admin-product-resilience` and `product-builder-matrix`.
- **The brief's 23-scenario test matrix**:

| # | Scenario | Covered by | Result |
|---|---|---|---|
| 1 | Simple product | matrix: created in the builder with SKU/stock, photo, reviewed, published; storefront has no pickers | pass |
| 2 | Colour only | matrix: no size field; colour picker on the storefront | pass |
| 3 | Size only | matrix: Fragrance with Volume only, no colour anywhere | pass |
| 4 | Colour + size | wizard spec (Clothing) and the acceptance spec (4 variants through checkout) | pass |
| 5 | Variant with no colour | matrix #3 (the stored variant has no colour) | pass |
| 6 | Variant with no size | matrix #2 | pass |
| 7 | No variants | matrix #1: no Options step, one default variant carrying SKU and stock | pass |
| 8 | No care | matrix #1: no Care step, no care row in Review, publishes | pass |
| 9 | No material | matrix #1, same | pass |
| 10 | No FAQ | matrix #1: publishes with none; preview spec: FAQ switched off disappears | pass |
| 11 | No related products | matrix #1: publishes with none | pass |
| 12 | No size guide | matrix #1: no Size Guide step or row; no size-guide link on the storefront | pass |
| 13 | Product type change | matrix: Clothing → Fragrance explains what's kept/removed; value is kept and comes back after switching back and reloading | pass |
| 14 | Image upload failure | resilience spec: a photo whose upload fails stays visible with Retry; Retry uploads it | pass |
| 15 | Network failure | resilience spec: a failed autosave keeps what was typed, says "Couldn't save", and the next edit saves it | pass |
| 16 | Browser refresh | matrix: unsaved new draft restored with its step; saved product reopens on its step | pass |
| 17 | Published slug change | matrix: notice shown; autosave doesn't change the URL; "Change URL" does; redirect active; old URL redirects to the new one | pass |
| 18 | Publish | matrix #1 and #2 (including refused-then-fixed) | pass |
| 19 | Unpublish | matrix: product disappears from the public API at once | pass |
| 20 | Live preview, all views and sizes | preview spec: 5 views × desktop/tablet/mobile, unsaved values shown as typed | pass |
| 21 | Preview with features switched off | preview spec: care, size guide, FAQ and reviews switched off disappear from the preview | pass |
| 22 | Owner permissions | matrix: owner isn't refused AI (the call reaches the AI module) | pass |
| 23 | Staff permissions | matrix: staff builds and publishes a product; no AI buttons; the API refuses AI, CSV import and permanent delete for staff with 403 | pass |

## 6. Test results

| Check | Result |
|---|---|
| API unit + integration tests (25 files, real Postgres) | **299 of 299 passed** |
| `tsc --noEmit` (web) | clean |
| ESLint (web) | 0 errors; the same 2 old `<img>` warnings |
| Matrix spec `product-builder-matrix` (9 tests × desktop + mobile) | **18 of 18 passed.** First runs failed in two places, both fixed or explained: one wrong assertion of mine (it expected a type change to delete the hidden value; the builder keeps it, as designed) and one network reset from the local API (passed unchanged on re-run) |
| Product and storefront browser specs (10 files, 152 tests, desktop + mobile) | **144 passed, 2 failed, 6 not run** (the rest of a serial file after the failure). Both failures were acceptance test 9, which still clicked the old editor's tabs after "Open the copy" moved to the builder; test updated |
| Acceptance spec + matrix spec re-run after that fix and the redirect fallback | **56 of 56 passed** |

Not re-run after the last two edits (the acceptance test fix and the product-page redirect fallback): the other 8 browser spec files. Those edits touch only one test and the product page's not-found path, which the re-run specs exercise.

`customer-accounts.spec.ts` was not part of this run; it fails in this environment for the reason given in the earlier report (a live mail-provider key that rejects example.com).

## 7. Known limitations and things not verified

- **Cross-service revalidation has not been exercised end to end with the secret set.** Locally `REVALIDATE_SECRET` is unset, so the storefront falls back to its 60-second refresh. The tag list and every call site are unit-tested; the actual API → web call should be checked once after deploy: rename or unpublish a product and confirm the public page changes within a couple of seconds.
- **The redirect fallback on the product page (section 3) has not been exercised.** In tests the middleware redirects first, because the dev server doesn't cache its redirect list. The fallback only runs when that list is stale, which happens only in production. It relies on the same tag refresh as the point above.
- **The old tabbed editor still exists** (deliberate, see section 3).
- The live preview doesn't show reviews, "frequently bought together" or other rails that depend on real orders/reviews; it shows the product's own content only.
- A new product needs Basics and Pricing (and variants, for a type with size/colour) before the draft exists, because the API validates a type's required options on create. Photos picked before that are uploaded right after the draft is created.
- Unsaved new drafts are kept in that one browser only (local storage), not on the server.
- Duplicate SKUs are highlighted within the product as you type; clashes with *other* products are caught by the API on save, not as you type.
- There is no "replace this image" action; delete and upload again.
- Local environment: Redis isn't running, so the API logs connection errors and serves without its cache; this doesn't affect results but means cache timing wasn't tested locally.
- `next build` fails locally at standalone tracing with the Windows-only `EPERM: symlink` (as before); CI/Docker builds it.

## 8. Is it ready for production?

Ready to merge and deploy, with one check after the deploy: the revalidation call (section 7, first point). If that check fails, nothing breaks; storefront pages just keep refreshing on the old 60-second timer.

The builder, preview, autosave, redirects and permissions are covered by passing tests on desktop and mobile. There are no migrations, so deploy order doesn't matter for this program.

## 9. Commands that must be run

1. Merge the stacked PRs in order: #11 → #12 → #13 → #14 → #15 → #16 → #17. Each is based on the previous one, after the earlier product-management PRs.
2. Add the GitHub Actions secret `REVALIDATE_SECRET`: any long random string, e.g. the output of `openssl rand -hex 32`. `ci.yml` writes it into `docker/.env` for both containers.
3. No migrations and no new dependencies.
4. To re-run the checks: `pnpm --filter api test`, and in `apps/web` run `npx playwright test` against a running stack, with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` for an owner account. The matrix spec also needs a staff account in `E2E_STAFF_EMAIL`/`E2E_STAFF_PASSWORD`.

## 10. Environment variables

| Variable | Where | Needed? | Effect when unset |
|---|---|---|---|
| `REVALIDATE_SECRET` | API and web (same value) | recommended | pages refresh on the 60-second timer only |
| `WEB_INTERNAL_URL` | API | set to `http://web:3000` in `docker-compose.yml` | falls back to `WEB_ORIGIN` (the public URL) |
