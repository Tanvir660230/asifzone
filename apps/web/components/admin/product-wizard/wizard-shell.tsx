"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { computeWizardSteps, type Category, type CompletenessCheckKey, type CreateProductInput, type Product, type ProductStatus, type WizardStepId } from "@clothing-brand/shared";
import { useProductFormState } from "@/components/admin/product-form-state";
import { ProductStatusPanel, type FixTarget } from "@/components/admin/product-status-panel";
import type { StagedImage } from "@/components/admin/image-uploader";
import * as productsApi from "@/lib/api/products";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { resolvePreviewProduct } from "@/lib/wizard/resolve-preview";
import { setPendingUploads } from "@/lib/wizard/pending-uploads";
import { cn } from "@/lib/utils";
import { ProgressHeader } from "./progress-header";
import { ProductHistory } from "@/components/admin/product-history";
import { PreviewPane } from "./preview-pane";
import {
  BasicsStep,
  MediaStep,
  PricingStep,
  VariantsStep,
  CareStep,
  SizeGuideStep,
  ContentStep,
  SeoStep,
  PreviewStep,
  ReviewStep,
  PublishStep,
} from "./steps";
import type { WizardActions, WizardState } from "./types";

/** Steps meaningful before the product exists. Always Basics/Media/Pricing — and, when the type has
 * variant options, Variants too: the server validates a type's declared size/color dimensions on
 * *every* save, including the very first create (not just the READY/PUBLISHED completeness gate), so
 * a type with a size or color dimension can't be created with the untouched blank default variant —
 * the admin has to see the Variants step and give it a real one before a draft can exist at all. */
const PRE_CREATE_ELIGIBLE: WizardStepId[] = ["basics", "media", "pricing", "variants"];

const DRAFT_STORAGE_KEY = "pim-wizard-new-draft-v1";

interface LocalDraft {
  values: Partial<CreateProductInput>;
  step?: WizardStepId;
}
function readLocalDraft(): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDraft;
    return parsed.values ? parsed : null;
  } catch {
    return null;
  }
}
function writeLocalDraft(values: Partial<CreateProductInput>, step: WizardStepId) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ values, step, savedAt: new Date().toISOString() }));
  } catch {
    // best-effort only — localStorage can be unavailable (private mode, quota) without this mattering much
  }
}
function clearLocalDraft() {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // see writeLocalDraft
  }
}

function renderStep(
  id: WizardStepId,
  state: WizardState,
  extra: { categories: Category[]; relationNames: Record<string, string>; onRelationNames: (added: Record<string, string>) => void; actions: WizardActions },
) {
  switch (id) {
    case "basics":
      return <BasicsStep state={state} categories={extra.categories} />;
    case "media":
      return <MediaStep state={state} />;
    case "pricing":
      return <PricingStep state={state} />;
    case "variants":
      return <VariantsStep state={state} />;
    case "care":
      return <CareStep state={state} />;
    case "sizeGuide":
      return <SizeGuideStep state={state} />;
    case "content":
      return <ContentStep state={state} relationNames={extra.relationNames} onRelationNames={extra.onRelationNames} />;
    case "seo":
      return <SeoStep state={state} actions={extra.actions} />;
    case "preview":
      return <PreviewStep state={state} />;
    case "review":
      return <ReviewStep state={state} actions={extra.actions} />;
    case "publish":
      return <PublishStep state={state} actions={extra.actions} />;
    default:
      return null;
  }
}

/** Maps a completeness check to the wizard step that fixes it — the wizard's answer to
 * ProductStatusPanel's "Fix" links, which normally target a tab id (see FixTarget). */
const FIX_TO_STEP: Record<FixTarget, WizardStepId> = {
  basic: "basics",
  pricing: "pricing",
  variants: "variants",
  care: "care",
  seo: "seo",
  images: "media",
};

interface ProductWizardProps {
  categories: Category[];
  /** Present only in edit mode (the product already exists) — its absence is what puts the wizard
   * in "new" mode, where only Basics/Media/Pricing are reachable and Continue past Pricing creates it. */
  initial?: Product;
}

export function ProductWizard({ categories, initial }: ProductWizardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const mode = initial ? "edit" : "new";

  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [relationNames, setRelationNames] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.relations ?? []).flatMap((r) => (r.products ?? []).map((p) => [p.id, p.name] as const))),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [applyingSlug, setApplyingSlug] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const formState = useProductFormState({ initial, stagedImages });
  const { form, selectedConfig, resolvedSections, completeness, withPrunedAttributes } = formState;
  const wizardState: WizardState = { ...formState, stagedImages, onStagedChange: setStagedImages };

  const allSteps = computeWizardSteps(selectedConfig ?? null, resolvedSections);
  const preCreateSteps = allSteps.filter((s) => PRE_CREATE_ELIGIBLE.includes(s.id));
  const visibleSteps = mode === "new" ? preCreateSteps : allSteps;
  const lastPreCreateStepId = preCreateSteps[preCreateSteps.length - 1]!.id;
  // `?step=` lets a redirect land on a specific step — e.g. Media right after creation, where the photos picked
  // before the product existed are uploading.
  const requestedStep = searchParams.get("step") as WizardStepId | null;
  const [currentStepId, setCurrentStepId] = useState<WizardStepId>(
    requestedStep && visibleSteps.some((s) => s.id === requestedStep) ? requestedStep : visibleSteps[0]!.id,
  );
  // A requested dynamic step (Variants, Care, Size Guide) only exists once the type config has loaded, after the
  // first render — honour the request when it appears, once, rather than silently landing on Basics.
  const [pendingStep, setPendingStep] = useState<WizardStepId | null>(requestedStep);
  useEffect(() => {
    if (pendingStep && visibleSteps.some((s) => s.id === pendingStep)) {
      setCurrentStepId(pendingStep);
      setPendingStep(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStep, visibleSteps.map((s) => s.id).join(",")]);
  // In "edit" mode every step already has real, saved data behind it — there's no "haven't gotten
  // there yet" to gate, so every step starts reachable (spec: completed steps are directly
  // accessible). "new" mode keeps the guided, one-at-a-time gating: nothing exists to jump to yet.
  const [visitedIds, setVisitedIds] = useState<Set<WizardStepId>>(() => (mode === "edit" ? new Set(allSteps.map((s) => s.id)) : new Set([visibleSteps[0]!.id])));
  const currentIndex = Math.max(0, visibleSteps.findIndex((s) => s.id === currentStepId));

  // The type-config fetch that `allSteps` depends on resolves after mount, so a dynamic step (e.g.
  // Variants) can appear on a later render than the one that set visitedIds's one-time initial value —
  // keep every step reachable in edit mode as the real step list fills in, not just whatever existed
  // at the very first synchronous render.
  useEffect(() => {
    if (mode !== "edit") return;
    setVisitedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const s of allSteps) if (!next.has(s.id)) { next.add(s.id); changed = true; }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, allSteps.map((s) => s.id).join(",")]);

  // A step the admin is on can disappear mid-flow (e.g. switching the product type away from one
  // with variant options while on the Variants step) — land on the nearest step that's still there
  // rather than silently rendering nothing for an id no longer in the list.
  useEffect(() => {
    if (!visibleSteps.some((s) => s.id === currentStepId)) {
      setCurrentStepId(visibleSteps[Math.min(currentIndex, visibleSteps.length - 1)]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSteps.map((s) => s.id).join(",")]);

  // Draft recovery (new mode only): a mid-Basics/Media/Pricing refresh has nothing on the server yet
  // to recover from, so the in-progress values live in localStorage until the product is created.
  // Offered as an inline choice, not a blocking dialog (spec: no unnecessary confirmation dialogs).
  const [recovery, setRecovery] = useState<LocalDraft | null>(null);
  useEffect(() => {
    if (mode !== "new") return;
    const saved = readLocalDraft();
    if (saved && (saved.values.name || saved.values.categoryId)) setRecovery(saved);
  }, [mode]);
  function resumeDraft() {
    if (!recovery) return;
    form.reset({ ...form.getValues(), ...recovery.values });
    // The saved step may be a dynamic one (Variants) that only appears once the restored type's config resolves.
    if (recovery.step) setPendingStep(recovery.step);
    setRecovery(null);
  }
  function discardDraft() {
    clearLocalDraft();
    setRecovery(null);
  }

  // Where the admin is survives a refresh: in the URL once the product exists, in the local draft before that.
  useEffect(() => {
    if (mode === "edit") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("step") !== currentStepId) {
        url.searchParams.set("step", currentStepId);
        window.history.replaceState(window.history.state, "", url);
      }
    } else if (!recovery && (form.getValues("name") || form.getValues("categoryId"))) {
      writeLocalDraft(form.getValues(), currentStepId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStepId, mode]);

  /** A live product's URL changes only through the explicit "Change URL" confirmation in the SEO step — never as a
   * side effect of autosave (which would publish every half-typed slug and leave a redirect for each). */
  function forSave(values: CreateProductInput): CreateProductInput {
    const pruned = withPrunedAttributes(values);
    if (initial?.status !== "PUBLISHED") return pruned;
    const { slug: _slug, ...rest } = pruned;
    void _slug;
    return rest as CreateProductInput;
  }

  // Autosave: localStorage before the product exists, a debounced PATCH once it does.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStepRef = useRef(currentStepId);
  currentStepRef.current = currentStepId;
  useEffect(() => {
    const sub = form.watch((values) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (mode === "new") {
          writeLocalDraft(values as Partial<CreateProductInput>, currentStepRef.current);
        } else if (initial) {
          setSaveState("saving");
          productsApi
            .updateProduct(initial.id, forSave(values as CreateProductInput))
            .then(() => {
              setSaveState("saved");
              void queryClient.invalidateQueries({ queryKey: ["product", initial.id] });
            })
            // A failed autosave just retries on the next edit — the admin's typed values stay in the
            // form either way, nothing is lost, per the spec's "preserve local state, provide recovery."
            .catch(() => setSaveState("error"));
        }
      }, 900);
    });
    return () => {
      sub.unsubscribe();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initial?.id]);

  function goTo(id: WizardStepId) {
    setPendingStep(null); // the admin chose where to be — a ?step= request still waiting mustn't override that
    setCurrentStepId(id);
    setVisitedIds((prev) => new Set(prev).add(id));
  }

  async function handleCreate() {
    // Deliberately NOT form.trigger()/the shared resolver here: buildResolver also runs the config-
    // aware variant/attribute validation (validateProductAgainstConfig), which would demand a size or
    // color for a type that has those dimensions — but the Variants step doesn't exist yet at this
    // point in "new" mode, so that check can never be satisfied here. This gate only needs the plain
    // minimum a create actually requires (see createProductSchema): the rest is validated for real
    // once the admin reaches the steps that ask for it.
    const currentValues = form.getValues();
    const missing: string[] = [];
    if (!currentValues.name?.trim()) missing.push("a product name");
    if (!currentValues.categoryId) missing.push("a category");
    if (!currentValues.typeId) missing.push("a product type");
    if (!currentValues.basePrice || currentValues.basePrice <= 0) missing.push("a base price above zero");
    if (missing.length) {
      setError(`Before this draft can be created: ${missing.join(", ")}.`);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const values = withPrunedAttributes(form.getValues());
      const variants = [...(values.variants ?? [])];
      // The admin hasn't reached the Variants step yet (it only appears after creation) — give the
      // one default variant a real SKU now so the create payload is valid; it's fully editable, and
      // regeneratable, from the Variants step afterward.
      if (variants[0] && !variants[0].sku && selectedConfig?.typeId) {
        const { sku } = await catalogApi.generateSku({ typeId: selectedConfig.typeId, color: variants[0].color, size: variants[0].size, taken: [] });
        variants[0] = { ...variants[0], sku };
      }
      const { product } = await productsApi.createProduct({ ...values, variants, status: "DRAFT" });
      clearLocalDraft();
      if (stagedImages.length) {
        // The edit page's Media step uploads them one by one with progress, and any that fail stay there with a
        // Retry — rather than a batch upload here whose failure could only be reported as "try again later".
        setPendingUploads(product.id, stagedImages.map((s) => s.file));
        toast.success(`"${product.name}" saved as a draft — uploading its photos`);
        router.push(`/admin/products/wizard/${product.id}/edit?step=media`);
      } else {
        toast.success(`"${product.name}" saved as a draft — continue filling it in`);
        router.push(`/admin/products/wizard/${product.id}/edit`);
      }
    } catch (err) {
      setError(describeApiError(err, "Failed to create product"));
    } finally {
      setCreating(false);
    }
  }

  function handleContinue() {
    if (mode === "new" && currentStepId === lastPreCreateStepId) {
      void handleCreate();
      return;
    }
    const next = visibleSteps[currentIndex + 1];
    if (next) goTo(next.id);
  }
  function handleBack() {
    const prev = visibleSteps[currentIndex - 1];
    if (prev) goTo(prev.id);
  }

  /** The panel's action buttons flush the current form state immediately (rather than waiting for
   * the autosave debounce) and, when a status is passed, move the product to it. */
  async function handlePanelAction(status?: ProductStatus): Promise<boolean> {
    if (!initial) return false;
    setBusy(true);
    try {
      // The server re-runs the full completeness gate on a move to READY/PUBLISHED — it's the authority, not this page.
      const { product } = await productsApi.updateProduct(initial.id, { ...forSave(form.getValues()), ...(status ? { status } : {}) });
      await queryClient.invalidateQueries({ queryKey: ["product", initial.id] });
      setSaveState("saved");
      setJustPublished(status === "PUBLISHED");
      toast.success(
        status === "PUBLISHED" ? "Product published" : status === "UNPUBLISHED" ? "Product unpublished" : status === "READY" ? "Marked ready to publish" : status === "DRAFT" ? "Moved back to draft" : `"${product.name}" saved`,
      );
      return true;
    } catch (err) {
      toast.error(describeApiError(err, "Failed to save"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function applySlug(slug: string) {
    if (!initial) return;
    setApplyingSlug(true);
    try {
      await productsApi.updateProduct(initial.id, { slug });
      await queryClient.invalidateQueries({ queryKey: ["product", initial.id] });
      toast.success(`URL changed to /product/${slug} — the old address now redirects there`);
    } catch (err) {
      toast.error(describeApiError(err, "Couldn't change the URL"));
    } finally {
      setApplyingSlug(false);
    }
  }

  /** Which step fixes a completeness check, given the steps this product actually has. */
  function stepForCheck(key: CompletenessCheckKey): WizardStepId {
    const has = (id: WizardStepId) => visibleSteps.some((s) => s.id === id);
    switch (key) {
      case "pricing":
        return "pricing";
      case "images":
        return "media";
      case "variants":
      case "inventory":
        return has("variants") ? "variants" : "pricing";
      case "seo":
        return "seo";
      case "sizeGuide":
        return has("sizeGuide") ? "sizeGuide" : "basics";
      case "material":
      case "care":
        return has("care") ? "care" : "content";
      default:
        return "basics";
    }
  }

  const actions: WizardActions = {
    fix: (key) => goTo(stepForCheck(key)),
    goTo,
    saveWithStatus: handlePanelAction,
    busy,
    justPublished,
    applySlug,
    applyingSlug,
  };

  function jumpToFix(target: FixTarget) {
    if (target === "images" && mode === "new") return; // Media is already reachable; nothing to jump to yet
    const stepId = FIX_TO_STEP[target];
    if (visibleSteps.some((s) => s.id === stepId)) goTo(stepId);
  }

  // Same query keys CareMaterialSection uses, so these are the lists it already loaded — nothing extra is fetched.
  const { data: careData } = useQuery({ queryKey: ["catalog-care-guides"], queryFn: catalogApi.listCareGuides });
  const { data: materialsData } = useQuery({ queryKey: ["catalog-materials"], queryFn: catalogApi.listMaterials });
  const [showPreview, setShowPreview] = useState(true);
  const previewProduct = resolvePreviewProduct(
    form.watch(),
    { config: selectedConfig ?? null, resolvedSections, categories, careGuides: careData?.careGuides ?? [], materials: materialsData?.materials ?? [] },
    {
      initial,
      // Before creation the photos only exist in this browser (staged object URLs) — the preview shows them anyway.
      images: initial ? initial.images : stagedImages.map((s, i) => ({ id: s.key, productId: "preview", url: s.previewUrl, altText: null, sortOrder: i })),
    },
  );

  const productName = form.watch("name");
  const percentComplete = completeness.score;

  return (
    <div className={cn("grid grid-cols-1 items-start gap-6", showPreview && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
    <div className="min-w-0 space-y-6">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowPreview((v) => !v)} className="text-xs text-ink-500 underline hover:text-ink-900" data-testid="toggle-preview">
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      </div>
      {mode === "edit" && (
        <ProductStatusPanel
          status={initial!.status}
          result={completeness}
          createLabel="Save"
          busy={busy}
          onAction={(status) => void handlePanelAction(status)}
          onFix={jumpToFix}
        />
      )}

      <ProgressHeader steps={visibleSteps} currentStepId={currentStepId} visitedIds={visitedIds} onSelect={goTo} productName={productName} percentComplete={percentComplete} />

      {recovery && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brass-200 bg-brass-50 px-4 py-3 text-sm text-brass-900" role="status" data-testid="resume-draft">
          <span>Continue where you left off on &ldquo;{recovery.values.name || "a new product"}&rdquo;?</span>
          <span className="flex gap-2">
            <Button type="button" size="sm" variant="brass" onClick={resumeDraft}>
              Continue
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={discardDraft}>
              Start fresh
            </Button>
          </span>
        </div>
      )}

      {mode === "new" && (
        <p className="text-xs text-ink-400" data-testid="wizard-autosave-status">
          This draft isn&rsquo;t saved yet — it&rsquo;s created once you finish {visibleSteps[visibleSteps.length - 1]!.label}.
        </p>
      )}
      {mode === "edit" && (
        <p className="text-xs text-ink-400" data-testid="wizard-autosave-status">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save — will retry on your next change" : "Autosave on"}
        </p>
      )}

      {error && <p className="text-sm text-danger-600">{error}</p>}

      <div className="rounded-xl border border-ink-100 bg-white p-5">{renderStep(currentStepId, wizardState, { categories, relationNames, onRelationNames: (added) => setRelationNames((prev) => ({ ...prev, ...added })), actions })}</div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={handleBack} disabled={currentIndex === 0 || creating}>
          Back
        </Button>
        {!(mode === "new" && currentStepId === lastPreCreateStepId) && currentIndex < visibleSteps.length - 1 && (
          <Button type="button" variant="brass" onClick={handleContinue}>
            Continue
          </Button>
        )}
        {mode === "new" && currentStepId === lastPreCreateStepId && (
          <Button type="button" variant="brass" onClick={handleContinue} disabled={creating}>
            {creating ? "Creating…" : "Continue"}
          </Button>
        )}
      </div>

      {mode === "edit" && (
        <div className="rounded-xl border border-ink-100 bg-white p-5">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-sm font-medium text-ink-900 hover:text-brass-700" aria-expanded={showHistory}>
            History
          </button>
          <p className="text-xs text-ink-400">Who changed what on this product, and when.</p>
          {showHistory && (
            <div className="mt-4">
              <ProductHistory productId={initial!.id} />
            </div>
          )}
        </div>
      )}
    </div>
    {showPreview && (
      <aside className="min-w-0 xl:sticky xl:top-4" aria-label="Live preview">
        <PreviewPane product={previewProduct} height={720} />
      </aside>
    )}
    </div>
  );
}
