# Product Builder

The Product Builder is the store's single product editor. It creates and edits every product type, at `/admin/products/new` and `/admin/products/:id/edit`. The old `/admin/products/wizard/*` URLs redirect there and keep their `?step=`.

## Architecture

```
app/admin/(shell)/products/new/page.tsx          ─┐  pages: data loading + page header only
app/admin/(shell)/products/[id]/edit/page.tsx    ─┘
        │
components/admin/product-builder/
  builder.tsx            ProductBuilder: layout only (status panel, sticky step header, step card, preview)
  use-product-builder.ts useProductBuilder: ALL builder behavior
  stepper.tsx            step track (one list, all screen sizes; status per step)
  steps.tsx              one pane per step (Basics … Publish)
  step-meta.ts           step guidance copy + "which step owns this field / check"
  preview-pane.tsx       live preview frame + surface/device toggles (SegmentedControl)
  live-preview-frame.tsx renders the REAL storefront components inside the iframe
        │
components/admin/product-form-state.ts   useProductFormState: the form, type/template config, validation, completeness
packages/shared                          wizard steps, completeness checks, validation, sections, SKU, pricing engines
```

| Concern | Single source of truth |
|---|---|
| Which steps exist, in what order | `computeWizardSteps()` (`packages/shared/src/wizard-steps.ts`), driven by the product type's template and resolved sections |
| What a type asks for (fields, variant options, size guide, care, sections) | `ProductTypeDef` → `ProductTemplate` (+ `TemplateAttribute`, presets), resolved by the catalog API |
| Validation | `buildResolver()` = `createProductSchema` + `validateProductAgainstConfig()`. The server runs the same rules on every save. |
| Completeness and publish readiness | `computeCompleteness()` (shared). The UI only displays it; `stepForCheck()` says where each check is fixed. |
| Page sections | `resolveSections()`: product → template → global → registry default |
| SKUs | `POST /api/catalog/sku/generate` (pattern + atomic counter) |
| Prices charged | server pricing engine. The builder only shows an informational margin. |
| Uploads | `ImageUploader` → `/api/products/:id/images` (sharp → WebP renditions). Photos picked before creation are handed over by `lib/wizard/pending-uploads.ts`. |
| Preview | `resolvePreviewProduct()` → `postMessage` → `LivePreviewFrame` (same storefront components as the live page) |

## Workflow

- **New:** Basics → Media → Pricing & Inventory → (Options & Variants, when the type has options). "Continue" on the last of these:
  1. runs the shared validation
  2. generates a simple product's SKU
  3. creates the product as a **DRAFT**
  4. opens it in edit mode (on Media, if photos were picked)
- **Draft protection (new):** values are kept in `localStorage` and offered back ("Continue where you left off").
- **Edit:** every step is reachable.
  - Changes **autosave** after 900ms.
  - The save state is always shown (Unsaved changes / Saving… / Saved / Couldn't save — *reason*).
  - Leaving with an unsaved change asks first.
  - **Ctrl/⌘+S** saves now.
- **Explicit save / status changes** (status panel, Publish step) validate first, then jump to the first step with an error.
- **Step status:** current · complete · needs attention (a required publish check it owns is missing) · has errors (a field failed validation).
- **Live product URL** changes only through the explicit "Change URL" confirmation, which creates a 301 redirect.

## Classic editor (retired)

The tabbed `ProductForm` and its two pages were removed after their functionality was confirmed present in the builder:

| Classic capability | Where it is now |
|---|---|
| Sort order field | Basics → Merchandising |
| Tab error dots | Stepper "has errors" status, plus inline field errors |
| One-shot validated create | Validation runs when the draft is created; problems open on the step that fixes them |
| Explicit Save | Status panel buttons and Ctrl/⌘+S |
| Size guide inside Basic Info | Its own Size Guide step (only for types that use a guide) |
| Images card above the form | Media step |
| History tab | History panel (header button) |

E2E coverage moved with it. Specs drive the builder through `e2e/support/product-builder.ts` (`continueTo`, `createDraft`, `goToStep`, `stepChip`).
