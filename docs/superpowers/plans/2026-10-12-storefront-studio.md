# Storefront Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modal-per-section homepage builder (`/admin/homepage`) with a full-screen **Storefront Studio**: a real-width live preview of the whole homepage (desktop / tablet / 375px mobile), click-to-select sections, an inspector with Content / Style / Visibility, autosaved drafts, one-click Publish, publish history with restore, smart page-health checks, and four new section types.

**Architecture:** The draft is one JSON document on the API (`HomepageDraft`, optimistic `version`), validated loosely on save and strictly on publish; publish writes the live `HomepageSection` rows in one transaction and snapshots a `HomepageRevision`. The preview is a same-origin iframe (`/admin/homepage-preview-frame`, the Product Builder pattern) rendering the real storefront header, sections and footer from posted draft state; the live homepage and the frame share one `HomeSection` renderer. Section styling is an `appearance` object inside each config, rendered only through tokens: `data-spacing` scales `--section-rhythm`, `data-tone` mirrors the band palette (new per-theme token output), `data-show` hides per device.

**Tech Stack:** Next.js 15 / React 19, TanStack Query, react-hook-form-free controlled inspector, @dnd-kit (already used), Express + Prisma + Postgres, zod (`@clothing-brand/shared`), Vitest (API), Playwright (e2e).

**Spec:** this document (owner request 2026-10-12: "premium storefront, beautiful preview, everything modifiable, smart"). Admin design choices are delegated (memory: admin-design-delegated).

## Global Constraints

- Admin: Apple-style, light only (`data-surface="admin"`), primitives from `components/ui/*`; no hard-coded colours, fonts or one-off styles in admin or storefront.
- Storefront visuals change only through tokens / `globals.css` recipes; works in both presets (`classic`, `mihrab`) and every theme; never branch on brand.
- Every new UI handles loading, empty and error states and works at 375px. The Studio editor itself is view-only below 768px (existing DR-25 rule).
- Preview frame lives under `/admin` (session-checked, noindex) and swallows link/cart clicks.
- Draft autosave debounce 800 ms; undo history 50 steps; revisions kept: last 20.
- Repeatable types after this change: `PRODUCT_CAROUSEL`, `PROMO_BANNER`, `BRAND_STORY`, `VALUES_GRID`, `RICH_TEXT`, `TESTIMONIALS`, `NEWSLETTER`, `IMAGE_GALLERY`. All others stay singletons (cannot be deleted, at most one).
- Existing `/api/homepage-sections` endpoints keep working (e2e `store-config.spec.ts` uses them).
- Migration name: `20261105100000_storefront_studio`. Never use the test/dev DB as a shadow DB.

## Review Focus

1. Two admins (or two tabs) editing: a stale tab's autosave must get 409 and show "Someone else changed the draft — reload", never silently overwrite. → Task 3 test `rejects a draft saved against an old version`.
2. Publishing a draft whose live section was deleted elsewhere / a draft id that no longer exists: publish creates it fresh rather than 500. → Task 3 test `publishes a draft section whose live row is gone`.
3. Half-typed invalid config (empty carousel heading) must autosave fine but block Publish with the error pinned to that section. → Task 3 test `saves an invalid draft but refuses to publish it`.
4. A section hidden on mobile still selected in the mobile preview: outline shows "Hidden on mobile", preview shows nothing, inspector still edits. → Task 9 e2e step.
5. Store with no draft and no sections (fresh install): Studio loads the seeded defaults as the draft base. → Task 3 test `returns the live sections when there is no draft`.

---

### Task 1: Shared schemas — appearance, new types, studio documents, health checks

**Files:**
- Modify: `packages/shared/src/schemas/homepage-section.ts`
- Create: `packages/shared/src/homepage-studio.ts` (export from package index)
- Test: `apps/api/src/modules/homepage-sections/homepage-studio.shared.test.ts`

**Interfaces — Produces:**
- `sectionAppearanceBase = { spacing?: "compact"|"default"|"spacious"; showOn?: "all"|"desktop"|"mobile" }`; per type `appearance` (optional) extends it:
  HERO `{ tone?: "theme"|"dark"|"light"; layout?: "theme"|"stacked"|"split" }` · BRAND_STORY `{ tone?; layout?: "image-right"|"image-left"|"backdrop" }` · PROMO_BANNER `{ tone?; width?: "contained"|"full"; align?: "center"|"start" }` · PRODUCT_CAROUSEL `{ rows?: 1|2 }` · CATEGORY_GRID / VALUES_GRID / TESTIMONIALS / RICH_TEXT / NEWSLETTER / IMAGE_GALLERY `{ background?: "default"|"muted" }` · others base only.
- New enum values + config schemas: `RICH_TEXT { eyebrow?, heading (1–200), bodyText? (≤2000), ctaLabel?, ctaHref?, align?: "start"|"center" }`, `TESTIMONIALS { heading?, count 3–12 default 6, minRating 3–5 default 4 }`, `NEWSLETTER { heading?, bodyText? }`, `IMAGE_GALLERY { heading?, items: {imageUrl, altText?, linkUrl?, caption?}[] 2–8, layout: "grid"|"mosaic" }`.
- `studioSectionSchema { id: string(1–64), type, isActive: boolean, config: unknown, startsAt, endsAt }`; `saveStudioDraftSchema { version: int≥0, sections: studioSectionSchema[] ≤60 }`.
- `validateStudioSections(sections): Record<string /*section id*/, string[] /*messages*/>` — config schema + singleton count + `startsAt > endsAt`.
- `studioHealthChecks(sections, now: Date): StudioCheck[]` with `StudioCheck { sectionId: string|null; level: "error"|"warning"|"tip"; code: string; message: string }`. Codes: `invalid` (from validateStudioSections, error), `schedule-expired`, `missing-alt`, `long-heading` (>70 chars), `cta-incomplete` (label xor link), `dark-bands-adjacent`, `no-hero` (tip), `wide-promo-no-mobile-image` (tip).

- [ ] **Step 1: Write failing tests** — `validateStudioSections` flags a second HERO and an empty-heading carousel by id; accepts a `RICH_TEXT` with appearance `{spacing:"compact"}`; rejects appearance `{tone:"neon"}`. `studioHealthChecks` returns `dark-bands-adjacent` for BRAND_STORY(tone dark) followed by PROMO_BANNER without image, `schedule-expired` for `endsAt` < now, `cta-incomplete` for ctaLabel without ctaHref, and nothing for the seeded defaults.
- [ ] **Step 2:** `pnpm --filter api test homepage-studio.shared` → FAIL (missing exports).
- [ ] **Step 3:** Implement; add new types to `configSchemaByType` and `REPEATABLE_SECTION_TYPES`.
- [ ] **Step 4:** Re-run → PASS; `pnpm --filter shared build` (or typecheck) clean.

### Task 2: Database — enum values, draft and revisions

**Files:** Modify `apps/api/prisma/schema.prisma`; Create `apps/api/prisma/migrations/20261105100000_storefront_studio/migration.sql`.

- `HomepageSectionType` + `RICH_TEXT TESTIMONIALS NEWSLETTER IMAGE_GALLERY`.
- `model HomepageDraft { id String @id @default("homepage"); version Int @default(0); sections Json; updatedById String?; updatedAt DateTime @updatedAt }`
- `model HomepageRevision { id String @id @default(cuid()); sections Json; publishedById String?; publishedByName String?; publishedAt DateTime @default(now()); @@index([publishedAt]) }`

- [ ] **Step 1:** Write migration SQL by hand (`ALTER TYPE … ADD VALUE` ×4, two `CREATE TABLE`), apply with `prisma migrate deploy` on the test DB, `prisma generate`.
- [ ] **Step 2:** `pnpm --filter api typecheck` passes.

### Task 3: API — studio service and routes (TDD)

**Files:** Create `apps/api/src/modules/homepage-sections/homepage-studio.service.ts`, `…/homepage-studio.integration.test.ts`; Modify `homepage-section.routes.ts`, `homepage-section.controller.ts`, `homepage-section.service.ts` (export `invalidateCache`, `ensureSeeded`, `listHomepageSections`).

**Interfaces — Produces (all `requireAdmin` + `content.manage`, prefix `/api/homepage-sections/studio`):**
- `GET /` → `{ version: number; sections: StudioSection[]; hasDraft: boolean; updatedAt: string|null; liveSections: StudioSection[] }`
- `PUT /draft` body `saveStudioDraftSchema` → `{ version }`; 409 `{ error: "Draft changed elsewhere", version }` on mismatch. Loose: shape only.
- `POST /publish` body `{ version }` → `{ sections: HomepageSection[] }`; 400 `{ error, details: Record<id,string[]> }` if `validateStudioSections` non-empty; deletes live repeatables missing from draft; refuses missing singletons; upserts by id (ids not in DB → create with new cuid); sortOrder = index; writes revision (prune >20); deletes draft; invalidates cache. One `$transaction`.
- `DELETE /draft` → 204. `GET /revisions` → `{ revisions: {id, publishedAt, publishedByName, sectionCount}[] }` (20). `POST /revisions/:id/restore` → loads revision into draft, returns studio payload.
- `GET /api/reviews/featured?count=6&minRating=4` (public, cached 300 s) → `{ reviews: {id, rating, body, customerName (first name + initial), productName, productSlug, createdAt}[] }` approved, non-empty body, newest first.

- [ ] **Step 1: Failing integration tests** (as owner via `asOwner()`): `returns the live sections when there is no draft`; `saves a draft and bumps version`; `rejects a draft saved against an old version` (409); `saves an invalid draft but refuses to publish it` (400, details keyed by that id); `publishes reorder + new RICH_TEXT + removed PROMO_BANNER` (live list matches, revision exists, draft gone); `publishes a draft section whose live row is gone`; `refuses to publish without a singleton`; `restores a revision into the draft`; `featured reviews hide unapproved and empty`. Restore original sections in `afterAll`.
- [ ] **Step 2:** Run `pnpm --filter api test homepage-studio` → FAIL.
- [ ] **Step 3:** Implement service, controller, routes, featured reviews.
- [ ] **Step 4:** Re-run → PASS; then full `pnpm --filter api test` alone (no concurrent vitest).

### Task 4: Tokens and recipes — tone, spacing, device visibility

**Files:** Modify `packages/ui-tokens/src/index.js` (+ `index.d.ts`), `apps/web/tailwind.config.ts`, `apps/web/app/globals.css`; Test: `apps/api/src/config/theme-tokens.test.ts`.

- Each theme gains `toneVariables: { light: lightBand(def)+bandComponents, dark: theme ink/cream palette + inverseBandVariables + darkBand(def) }`; plugin emits after the band rules `:root[data-brand=id] .ui-band-inverse[data-tone="light"|"dark"]`.
- `globals.css`: `:root{--section-rhythm-base:var(--section-rhythm)}`, `[data-spacing="compact"]{--section-rhythm:calc(var(--section-rhythm-base)*.6)}`, `spacious` ×1.45; `.ui-section-frame[data-show="desktop"]` hidden <1024px, `mobile` hidden ≥1024px; `[data-background="muted"]` → `background: rgb(var(--color-surface-muted))` via the semantic token.
- [ ] **Step 1:** Add contrast test: every theme's `toneVariables.light` and `.dark` keep text-on-surface ≥4.5:1 (reuse existing helper). Run → FAIL. **Step 2:** implement → PASS. **Step 3:** delete `apps/web/.next`, restart dev.

### Task 5: Shared homepage renderer + appearance in storefront components + new sections

**Files:**
- Create `apps/web/components/storefront/home/section-frame.tsx` — `SectionFrame({ id, appearance, children })` → `<div className="ui-section-frame" data-section-id data-spacing data-show data-background>`.
- Create `apps/web/components/storefront/home/home-section.tsx` — `HomeSection({ section, data: HomeSectionData, layout: StoreLayout })`; `HomeSectionData { settings; tree; banners; flashSale; carouselProducts: Map<string, Product[]>; reviews: FeaturedReview[] }`. Moves `renderSection` + preset switch out of `app/(storefront)/page.tsx`; `carouselListingHref`, `resolveProductCarouselProducts` move to `lib/homepage-data.ts`.
- Create `rich-text-section.tsx`, `testimonials-section.tsx`, `newsletter-section.tsx` (reuses `newsletter-form.tsx`), `image-gallery-section.tsx` in `components/storefront/`.
- Modify `hero.tsx` (`tone`, `layout` → `data-tone`, inline `--hero-layout-lg`), `brand-story.tsx` (`tone`, `layout`; backdrop = image fill + `--media-scrim`), `promo-banner-section.tsx` (`tone`, `width`, `align`), `product-carousel-section.tsx` (`rows`), mihrab equivalents accept and pass `tone` where they render a band.
- [ ] **Step 1:** Refactor page to `HomeSection` with no visual change; pixel-diff `/` before/after with `STORE_THEME=default` → 0 px.
- [ ] **Step 2:** Add appearance + new sections; `pnpm --filter web lint` + typecheck clean.

### Task 6: Preview frame + protocol

**Files:** Create `apps/web/lib/studio/preview-protocol.ts`, `apps/web/app/admin/(preview-frame)/homepage-preview-frame/page.tsx`, `apps/web/components/admin/studio/homepage-preview-frame.tsx`.

- Messages: parent→frame `studio:update { sections: StudioSection[]; selectedId: string|null }`, `studio:scroll-to { id }`; frame→parent `studio:ready`, `studio:select { id }`, `studio:sections-visible { hiddenIds: string[] }`. Origin + source checked both ways.
- Server page fetches settings, tree, social links, payment methods, banners, flash sale and renders `StoreHeader` + client frame + `StoreFooter` (no chat/cart drawers). Client resolves carousel products and featured reviews with React Query (debounced 300 ms on carousel config). Renders inactive sections? No — the frame renders only `isActive` + in-schedule sections, exactly like live.
- Hover: outline `outline-accent` + label chip with section name; click selects (captures and swallows link/button clicks); selected section gets a persistent outline and scrolls into view on `scroll-to`.

### Task 7: Studio state hook

**Files:** Create `apps/web/lib/studio/use-studio-draft.ts`, `apps/web/lib/api/admin-homepage-studio.ts`.

- `useStudioDraft()` → `{ status: "loading"|"error"|"ready"; sections; version; selectedId; select(id); update(id, patch: Partial<StudioSection>); updateConfig(id, config); add(type) → id; duplicate(id); remove(id); move(from, to); undo(); redo(); canUndo; canRedo; save: { state: "idle"|"saving"|"saved"|"conflict"|"error"; at?: Date }; dirtyVsLive: boolean; publish(): Promise<{ ok: true } | { ok: false; errors: Record<string,string[]> }>; discard(); restore(revisionId) }`.
- Reducer with past/future stacks (cap 50; text edits coalesce per field within 1 s). Autosave 800 ms after last change; on 409 state `conflict` and stop autosaving. New ids `new-<crypto.randomUUID()>`. `beforeunload` guard while saving.

### Task 8: Inspector — schema-driven fields

**Files:** Create `apps/web/components/admin/studio/section-fields.ts` (descriptor per type), `inspector.tsx`, `fields/*.tsx` (`TextField`, `TextareaField`, `LinkField`, `ImageField` (upload via `uploadHomepageSectionImage`, alt text, 5 MB limit, shows pixel size + "low resolution" hint <1200 px wide), `ChoiceField` (SegmentedControl), `NumberField`, `CategoryField` (SearchableSelect over category tree), `ItemsField` (sortable list of sub-fields; icon via `IconPicker`)).
- Descriptor: `{ key: string; label: string; kind: FieldKind; hint?: string; placeholder?: string; max?: number; options?: {value,label}[]; showIf?: (config) => boolean }[]` grouped in `content`, `style`.
- Inspector tabs: **Content**, **Style** (common spacing + per-type appearance), **Visibility** (active switch, show on, schedule from/until). Errors from `validateStudioSections` shown at the field and in the tab badge. Character counters on headings.
- Delete: `components/admin/homepage/*-form.tsx`, `section-config-panel.tsx`, `section-preview.tsx` (fold `section-meta.ts` into `components/admin/studio/section-meta.ts`, adding the four new types with icons and one-line descriptions).

### Task 9: Studio page

**Files:** Rewrite `apps/web/app/admin/(shell)/homepage/page.tsx`; Create `components/admin/studio/{studio-shell,top-bar,outline,add-section-gallery,canvas,history-popover,health-panel}.tsx`.

- Layout ≥1024px: top bar (title "Homepage", save state "Saved · 2 min ago" / "Saving…" / conflict alert, device SegmentedControl Desktop 1280 / Tablet 834 / Mobile 390, undo/redo IconButtons with ⌘Z / ⇧⌘Z, History, "View live" link, Discard (confirm), **Publish** primary — disabled with tooltip while errors; badge "Unpublished changes"), left outline 280 px (drag reorder, eye toggle, schedule/hidden-on-device badges, health dots, duplicate/delete menu, "+ Add section"), centre canvas (scaled iframe, grey well), right inspector 360 px. 768–1023px: inspector becomes a `Drawer`. <768px: read-only outline + "Open on a larger screen".
- Add-section gallery: Modal grid of cards, each a token-drawn mini wireframe (divs, not images) + name + description; singletons already present disabled "Already on the page"; inserts after the selected section and selects it.
- Health panel: popover from a top-bar "Checks" button listing `studioHealthChecks` (click → selects section).
- Loading: skeleton panes. Error: `ErrorState` with retry. Empty outline: EmptyState "Add your first section".

- [ ] **E2E** `apps/web/e2e/homepage-studio.spec.ts` (run against `clothing_brand_test` API): opens Studio; edits Brand Story heading → frame text updates without saving; switches Mobile → frame width 390; sets Brand Story "Show on: desktop" → outline shows "Hidden on mobile" and frame hides it; adds Rich text → appears in frame; Publish → `/` shows new heading; History lists the publish; restore previous → draft back; finally restores original sections via API.

### Task 10: Verification and docs

- [ ] `pnpm --filter api test` (alone), `pnpm --filter web lint`, typecheck, `pnpm --filter web test:e2e homepage-studio store-config`.
- [ ] `impeccable` critique + `web-design-guidelines` on `components/admin/studio/*` and the new storefront sections; fix findings.
- [ ] Playwright screenshots: Studio at 1440 and 1024; storefront `/` at 1440 and 375 with both themes (`STORE_THEME=default`, `nasihamart`).
- [ ] Update `docs/DESIGN_SYSTEM.md` §2a (tone/spacing/show recipes) and §4 (SectionFrame, HomeSection, new sections).
- [ ] `/code-review` on the branch. No commit or push without the owner's go-ahead.
