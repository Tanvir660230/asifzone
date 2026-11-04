# Multi-brand product page redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared, better product page (and landing-page parts) for Asif Zone, Nasihamart and Tahafi: admin-made Product Families shown as photo tiles, Bangla buying UI, uncropped 5:6 photos for AZ/NM, and one bottom bar on phones.

**Architecture:** A new `ProductFamily` table (members = existing products, nothing about a product changes) with an admin CRUD and one public read. The product page fetches a product's families on the server and renders a shared photo-tile picker. Brand differences stay in `themeDefinitions` tokens and the existing `storeLayout()` presets; no `if (brand)`.

**Tech Stack:** Prisma + Postgres, Express, Zod (`packages/shared`), Next.js 15 App Router, React 19, Tailwind 3, Vitest, Playwright.

**Spec:** Audit + proposal Doc https://claude.ai/artifact/QT2MPd4Vum5YrASrJdYSgb (sections "প্রস্তাবিত ডিজাইন সিস্টেম", "বাস্তবায়ন পরিকল্পনা", owner answers in "আপনার সিদ্ধান্ত").

## Global Constraints

- No commit, merge or deploy without the owner's explicit OK. Work stays in worktree `C:/dev/asifzone-pdp` (branch `feat/pdp-redesign`).
- Never change live prices, stock, orders, colour names or product data. Families only *link* products.
- Families are made by hand in admin; nothing groups products by name. A product may be in several families.
- Product name and description stay as entered; the buying UI is Bangla: সাইজ, কালার, কার্টে যোগ করুন, এখনই কিনুন, ডেলিভারি তথ্য, স্টক শেষ.
- AZ (`default`) and Nasihamart photo frame 5:6 with `object-fit: contain`, centred; Tahafi keeps its current 1:1 cover until new photos.
- A family member with stock 0 stays in the family, shown struck through and not orderable; 1–3 is orderable up to its stock (existing `maxSellableQuantity`).
- `POST /orders`, cart, pixels and the quote flow are untouched.
- Every UI handles loading, empty and error, works at 320 px, no horizontal scroll (CLAUDE.md).

## Review Focus

1. A family whose members are partly unpublished or in Trash → the PDP shows only published, non-deleted members, never a broken tile. (Task 2 test)
2. A product in two families → the PDP shows both, each with its own name, current product marked in each. (Task 2 test, Task 6 e2e)
3. A member without photos → tile falls back to the product's first image, or a neutral tile with the name; never an empty `<img>`. (Task 6 unit test)
4. A family of 1 visible member (all others unpublished) → no picker at all. (Task 6 unit test)
5. Bangla labels must not break the e2e flows that find buttons by English names. (Task 4 — update selectors in the same task)

---

### Task 1: ProductFamily data model and shared schemas

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (new models after `LandingPage`; back-relation on `Product`)
- Create: `apps/api/prisma/migrations/20261211100000_product_families/migration.sql`
- Create: `packages/shared/src/schemas/product-family.ts`; export from `packages/shared/src/index.ts`

**Interfaces — Produces:**
- `model ProductFamily { id String @id @default(cuid()); name String; members ProductFamilyMember[]; createdById String?; createdAt; updatedAt }`
- `model ProductFamilyMember { familyId; productId; sortOrder Int @default(0); label String? ; @@id([familyId, productId]); @@index([productId]) }` — both relations `onDelete: Cascade`.
- `saveProductFamilySchema = z.object({ name: text(80).min(1), members: z.array(z.object({ productId: z.string().min(1).max(40), label: optionalText(60) })).min(2).max(24).refine(unique productId, "A product is listed twice") })`
- Types: `ProductFamilySummary { id; name; memberCount; updatedAt }`, `ProductFamilyDetail { id; name; members: { productId; name; slug; status; imageUrl: string|null; label: string|null }[] }`, `PublicProductFamily { id; name; members: { productId; slug; name; label: string; imageUrl: string|null; imageAlt: string|null; price: number; available: boolean }[] }`.

- [ ] Step 1: add models + hand-written migration (CREATE TABLE ×2, FKs, index); `pnpm --filter api exec prisma generate`; expected: client generated, `prisma migrate diff --from-migrations … --to-schema-datamodel …` prints no difference (use the test DB, never as shadow DB — memory feedback_prisma_shadow_db).
- [ ] Step 2: shared schema + types; `pnpm --filter @clothing-brand/shared build` passes.

### Task 2: Families API (admin CRUD + public read)

**Files:**
- Create: `apps/api/src/modules/product-families/{product-family.service.ts,product-family.controller.ts,product-family.routes.ts,product-family.integration.test.ts}`
- Modify: `apps/api/src/app.ts` (`app.use("/api/product-families", productFamilyRouter)`)

**Interfaces — Produces:**
- Admin (`requireAdmin, requirePermission("catalog.manage")`): `GET /` → `{ families: ProductFamilySummary[] }`; `POST /` (body `saveProductFamilySchema`) → `{ family: ProductFamilyDetail }` 201; `GET /:id`; `PUT /:id`; `DELETE /:id` → 204.
- Public: `GET /for/:productId` → `{ families: PublicProductFamily[] }` — only families containing that product; members filtered to `status PUBLISHED`, `deletedAt null`, `kind FINISHED`; ordered by `sortOrder`; families with < 2 visible members dropped. `label` = member label ?? product name minus the words all members' names start with (reuse the prefix rule from `packages/shared/src/landing-collection.ts` — export `distinctNames(names: string[]): string[]` from there). `price` = server-resolved selling price of the cheapest active variant (same resolver the storefront list uses); `available` = any active variant sellable (`isAvailable(trackInventory, stock)` and not `markedSoldOut`). Response cached 60 s (`Cache-Control: public, max-age=60`).
- Service validation: every member exists, not in Trash, `kind FINISHED`; else 400 with the product's name.

- [ ] Step 1: write `product-family.integration.test.ts`: (a) owner creates a family of 3 → 201, members in given order; (b) STAFF without catalog.manage → 403; (c) duplicate productId → 400; (d) a material → 400; (e) `GET /for/:id` hides an unpublished member and a Trash member, keeps a stock-0 member with `available:false`; (f) product in two families → both returned; (g) only 1 visible member → family dropped; (h) DELETE removes family, products untouched (`prisma.product.findUnique` still returns them).
- [ ] Step 2: run `pnpm --filter api exec vitest run src/modules/product-families` → FAIL (route missing).
- [ ] Step 3: implement service/controller/routes; export `distinctNames` from shared and make `landingColorLabels` use it (its tests in `apps/web/lib/landing-collection.test.ts` must still pass).
- [ ] Step 4: run the family tests + `apps/web/lib/landing-collection.test.ts` + landing integration test → PASS.

### Task 3: Admin — Product families page

**Files:**
- Create: `apps/web/app/admin/(shell)/products/families/page.tsx` (list), `apps/web/app/admin/(shell)/products/families/[id]/page.tsx` (editor; `new` = id "new"), `apps/web/lib/api/product-families.ts`
- Modify: `apps/web/lib/admin/navigation.ts` (entry `products.families`, label "Product families", route `/admin/products/families`, capability `catalog.manage`, order 0.6)

**Interfaces — Consumes:** Task 2 endpoints. Reuse `components/admin/product-picker.tsx` (`selected`, `onChange`).

- Editor: name input; member list with photo, name, status chip, optional label input, up/down reorder, remove; ProductPicker to add; Save (PUT/POST), Delete with confirm; unpublished members show a "not on the store" chip (they are kept, the store hides them). Admin is Apple-style light, existing `components/ui/*` only. Loading/empty ("No families yet — make one to show matching products together")/error states.
- [ ] Step 1: build list + editor; `pnpm --filter web lint` and `tsc --noEmit` clean.
- [ ] Step 2: Playwright e2e `apps/web/e2e/product-families.spec.ts`: owner creates "Haven Collection" with 3 products, reorders, saves, reloads → same order; deletes → list empty state.

### Task 4: Bangla buying UI on the product page

**Files:**
- Create: `apps/web/lib/buy-copy.ts` — one object `BUY` with the strings below (single source; the landing page's existing Bangla copy keeps its own words).
- Modify: `components/storefront/{variant-selector,variant-option-pickers,sticky-add-to-cart,variant-picker-dialog,delivery-estimate,size-guide-modal,whatsapp-order-button,product-showcase}.tsx`; e2e specs that match `"Add to Cart"`, `"Buy Now"` (4 files under `apps/web/e2e`).

**Copy (exact):** size label "সাইজ" · colour label "কালার" (a variant dimension label that is already Bangla wins, as on the landing page) · "কার্টে যোগ করুন" · "এখনই কিনুন" · "স্টক শেষ" (was "Sold out"/"Out of stock") · "অল্প কয়েকটি বাকি" (Few left) · "স্টকে আছে" (In stock — ready to ship) · "সাইজ চার্ট" · "{label} বেছে নিন" (Please select a … to continue; both: "সাইজ ও কালার বেছে নিন") · "ডেলিভারি তথ্য" heading, "ঢাকার ভেতরে", "ঢাকার বাইরে", "আজ অর্ডার করলে সম্ভাব্য ডেলিভারি" · "WhatsApp-এ অর্ডার করুন" · "আপনার অপশন বেছে নিন" (Choose your options) · "পরিমাণ" · free delivery pill: "ফ্রি ডেলিভারি" (drop "· when everything in your bag ships free"; keep the "on <variants>" part as "— {variants}-এ").
- Cart page, product cards, checkout: unchanged (out of scope).
- [ ] Step 1: replace strings via `BUY`; update e2e selectors to the Bangla names in the same change.
- [ ] Step 2: `pnpm --filter web lint`, `tsc --noEmit`, `pnpm --filter web test` → PASS; run `e2e/landing-page.spec.ts` and the product/cart spec(s) touched → PASS.

### Task 5: Photo frame tokens

**Files:**
- Modify: `packages/ui-tokens/src/index.js` (storefront variables: `--product-photo-ratio`, `--product-photo-fit`; defaults `5 / 6` and `contain` in the base set = AZ; nasihamart `5 / 6`, `contain`; tahafi `1 / 1`, `cover`); `packages/ui-tokens/src/index.d.ts` if it lists variables.
- Modify: `apps/web/components/storefront/product-gallery.tsx` main frame + slides (`aspect-[var(--product-photo-ratio)]`, `[object-fit:var(--product-photo-fit)]`, keep `max-h-[80vh]`; thumbnails use the same ratio); `apps/web/components/landing/landing-gallery.tsx` and the landing colour tiles (same tokens).
- Docs: `docs/DESIGN_SYSTEM.md` §2 token list gets the two tokens.
- Not changed: product cards (`product-card*.tsx`) and homepage rails.
- [ ] Step 1: tokens + gallery; screenshot AZ, NM, Tahafi PDP at 375 and 1440 against the live data (recipe: `next dev` with `PUBLIC_API_URL=https://<store>`, temporary `remotePatterns` entry, reverted before any commit) → cap photos show their full stage (no crop), Tahafi product page pixel-identical to before at both widths. Tahafi's landing gallery moves from 4:5 cover to the token's 1:1, so its square photos stop losing their sides — the one intended Tahafi change.

### Task 6: Family picker on the product page

**Files:**
- Create: `apps/web/components/storefront/product-family-picker.tsx` (server-safe presentational component), `apps/web/components/storefront/photo-tile.tsx` (shared tile: image in the photo-frame token, name under it in up to 2 lines, selected ring, sold-out strike + 40 % opacity, `aria-current` for the current product) — also used by the landing order form's photo colours (replace its inline tile markup).
- Modify: `apps/web/lib/api/storefront.ts` (`getProductFamilies(productId)` → `PublicProductFamily[]`, 60 s revalidate, failures return `[]`), `apps/web/components/storefront/product-page-view.tsx` (fetch in the existing `Promise.all`), `product-showcase.tsx` (render each family above the variant selector: heading = family name, tiles link to `/product/<slug>`, current product selected and not a link).
- Test: `apps/web/components/storefront/product-family-picker.test.tsx` — (a) current product marked `aria-current="page"`; (b) sold-out member has a struck label and is still a link; (c) no image → neutral tile with name, no `<img>`; (d) family with 1 member renders nothing.
- [ ] Step 1: write the unit test → FAIL; implement → PASS.
- [ ] Step 2: e2e in `product-families.spec.ts` (Task 3 file): after creating the family, open member A's product page → 3 tiles, tap B → URL is B's product page, B's tile selected.

### Task 7: One bottom bar on phones

**Files:**
- Modify: `apps/web/components/storefront/product-showcase.tsx` (set `document.documentElement.dataset.pdp` while mounted), `mobile-bottom-nav.tsx` and `presets/tahafi/dock.tsx` (hidden when `html[data-pdp]` below 1024 px), `sticky-add-to-cart.tsx` (bottom offset 0 + safe-area when the nav is hidden), `sticky-bottom-bar-spacer.tsx` if it reserves tab-bar height.
- [ ] Step 1: implement; screenshot AZ, NM, Tahafi PDP at 320/375/390: no tab bar or dock on the product page, inline buttons not covered on the first screen, sticky bar appears after scrolling past them; other pages (home, category, cart) still show the tab bar/dock.
- [ ] Step 2: run the e2e specs that use the tab bar or dock (grep `mobile-bottom-nav`, `dock` in `apps/web/e2e`) → PASS.

### Task 8: Verification and report

- [ ] Step 1: `pnpm --filter api test` (alone — memory feedback_no_concurrent_vitest), `pnpm --filter web lint`, `pnpm --filter web test`, the e2e specs from Tasks 3–7 → all PASS, outputs saved.
- [ ] Step 2: screenshot matrix: 3 brands × {320, 375, 768, 1440} × {product page, landing page}; check no horizontal overflow (`scrollWidth <= innerWidth`), no cut tile names, buttons uncovered. Default (AZ) home/category/cart compared before/after → unchanged.
- [ ] Step 3: `impeccable` audit + `web-design-guidelines` on the changed files; fix findings.
- [ ] Step 4: report to the owner in Bangla with screenshots; ask for commit/PR approval. Deploy only after the owner approves (Tahafi deploy is the owner's).
