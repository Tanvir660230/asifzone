"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { computeWizardSteps, type Category, type CompletenessCheckKey, type CreateProductInput, type Product, type ProductStatus, type WizardStep, type WizardStepId } from "@clothing-brand/shared";
import { useProductFormState } from "@/components/admin/product-form-state";
import type { StagedImage } from "@/components/admin/image-uploader";
import * as productsApi from "@/lib/api/products";
import * as catalogApi from "@/lib/api/catalog";
import { describeApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { resolvePreviewProduct } from "@/lib/wizard/resolve-preview";
import { setPendingUploads } from "@/lib/wizard/pending-uploads";
import { productEditHref } from "@/lib/admin-routes";
import { stepForCheck, stepForField } from "./step-meta";
import type { WizardActions, WizardState } from "./types";

/** Steps meaningful before the product exists: Basics/Media/Pricing — and, when the type has variant options,
 * Variants too: the server validates a type's declared size/colour dimensions on every save, including the very first
 * create, so a variant-having type can't be created with the untouched blank default variant. */
const PRE_CREATE_ELIGIBLE: WizardStepId[] = ["basics", "media", "pricing", "variants"];

const DRAFT_STORAGE_KEY = "pim-wizard-new-draft-v1";
const AUTOSAVE_DELAY_MS = 900;

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
    // best-effort only — localStorage can be unavailable (private mode, quota)
  }
}
function clearLocalDraft() {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // see writeLocalDraft
  }
}

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** How a step reads in the stepper. `error`: a field on it failed validation; `attention`: a required publish check it
 * owns is missing; `complete`: reached and nothing required is missing. */
export type StepStatus = "current" | "error" | "attention" | "complete" | "upcoming";

export interface BuilderStep extends WizardStep {
  status: StepStatus;
  reachable: boolean;
  /** Required publish checks this step owns that are missing. */
  issues: number;
}

interface UseProductBuilderOptions {
  categories: Category[];
  /** Present in edit mode; its absence puts the builder in "new" mode (pre-create steps only). */
  initial?: Product;
}

/**
 * Everything the Product Builder does, independent of how it looks: the data-driven step list, navigation, step
 * status, local draft recovery (new), debounced autosave (edit), creation, explicit save / status changes and the
 * live-URL change. The shared `useProductFormState` underneath owns the form, the type/template config, validation
 * and the completeness score; this hook never re-derives any of those rules.
 */
export function useProductBuilder({ categories, initial }: UseProductBuilderOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const mode: "new" | "edit" = initial ? "edit" : "new";

  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [relationNames, setRelationNames] = useState<Record<string, string>>(() =>
    Object.fromEntries((initial?.relations ?? []).flatMap((r) => (r.products ?? []).map((p) => [p.id, p.name] as const))),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [applyingSlug, setApplyingSlug] = useState(false);

  const formState = useProductFormState({ initial, stagedImages });
  const { form, selectedConfig, resolvedSections, completeness, withPrunedAttributes, withStockExpectations, acknowledgeSavedStock } = formState;
  const state: WizardState = { ...formState, stagedImages, onStagedChange: setStagedImages };

  /* ── steps ─────────────────────────────────────────────────────────────────────────────── */

  const allSteps = computeWizardSteps(selectedConfig ?? null, resolvedSections);
  const preCreateSteps = allSteps.filter((s) => PRE_CREATE_ELIGIBLE.includes(s.id));
  const visibleSteps = mode === "new" ? preCreateSteps : allSteps;
  const stepKey = visibleSteps.map((s) => s.id).join(",");
  const has = useCallback((id: WizardStepId) => stepKey.split(",").includes(id), [stepKey]);
  const lastPreCreateStepId = preCreateSteps[preCreateSteps.length - 1]!.id;

  // `?step=` lands on a specific step (e.g. Media right after creation, where staged photos upload).
  const requestedStep = searchParams.get("step") as WizardStepId | null;
  const [currentStepId, setCurrentStepId] = useState<WizardStepId>(
    requestedStep && visibleSteps.some((s) => s.id === requestedStep) ? requestedStep : visibleSteps[0]!.id,
  );
  // A requested dynamic step (Variants, Care, Size Guide) only exists once the type config has loaded.
  const [pendingStep, setPendingStep] = useState<WizardStepId | null>(requestedStep);
  useEffect(() => {
    if (pendingStep && has(pendingStep)) {
      setCurrentStepId(pendingStep);
      setPendingStep(null);
    }
  }, [pendingStep, has]);

  // New mode guides one step at a time (nothing exists to jump to); in edit mode every step has saved data behind it.
  const [visitedIds, setVisitedIds] = useState<Set<WizardStepId>>(() =>
    mode === "edit" ? new Set(allSteps.map((s) => s.id)) : new Set([visibleSteps[0]!.id]),
  );
  const currentIndex = Math.max(0, visibleSteps.findIndex((s) => s.id === currentStepId));

  // Dynamic steps appear after the type config loads — keep every step reachable in edit mode as they fill in.
  useEffect(() => {
    if (mode !== "edit") return;
    setVisitedIds((prev) => {
      const ids = stepKey.split(",") as WizardStepId[];
      if (ids.every((id) => prev.has(id))) return prev;
      return new Set([...prev, ...ids]);
    });
  }, [mode, stepKey]);

  // The current step can disappear (e.g. switching to a type without options while on Variants) — land nearby.
  useEffect(() => {
    if (!has(currentStepId)) setCurrentStepId(visibleSteps[Math.min(currentIndex, visibleSteps.length - 1)]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  const goTo = useCallback((id: WizardStepId) => {
    setPendingStep(null); // the admin chose where to be — a waiting ?step= request mustn't override that
    setCurrentStepId(id);
    setVisitedIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  /* ── step status (validation + the shared completeness result) ─────────────────────────── */

  const errors = form.formState.errors;
  const errorSteps = new Set(Object.keys(errors).map((field) => stepForField(field, has)));
  const issuesByStep = new Map<WizardStepId, number>();
  for (const b of completeness.blockers) {
    const step = stepForCheck(b.key, has);
    issuesByStep.set(step, (issuesByStep.get(step) ?? 0) + 1);
  }
  const steps: BuilderStep[] = visibleSteps.map((s, i) => {
    const visited = visitedIds.has(s.id);
    // Missing publish requirements (e.g. "at least one photo") only matter once the product exists — before that the
    // admin is creating a draft, which doesn't need them, so no step is flagged for them yet. Validation errors still are.
    const issues = mode === "edit" ? (issuesByStep.get(s.id) ?? 0) : 0;
    // Before creation, steps the admin has moved past read as done; nothing ahead of them is judged yet.
    const judged = mode === "edit" || i < currentIndex;
    const status: StepStatus =
      s.id === currentStepId
        ? "current"
        : errorSteps.has(s.id)
          ? "error"
          : judged && issues > 0
            ? "attention"
            : visited && judged
              ? "complete"
              : "upcoming";
    return { ...s, status, issues, reachable: visited || s.id === currentStepId };
  });
  const currentStep = steps[currentIndex]!;

  /* ── local draft (new mode) ─────────────────────────────────────────────────────────────── */

  const [recovery, setRecovery] = useState<LocalDraft | null>(null);
  useEffect(() => {
    if (mode !== "new") return;
    const saved = readLocalDraft();
    if (saved && (saved.values.name || saved.values.categoryId)) setRecovery(saved);
  }, [mode]);
  function resumeDraft() {
    if (!recovery) return;
    form.reset({ ...form.getValues(), ...recovery.values });
    if (recovery.step) setPendingStep(recovery.step); // may be a dynamic step that appears once the type resolves
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

  /* ── saving ─────────────────────────────────────────────────────────────────────────────── */

  /** A live product's URL changes only through the explicit "Change URL" confirmation in SEO — never through
   * autosave (which would publish every half-typed slug and leave a redirect for each). */
  function forSave(values: CreateProductInput): CreateProductInput {
    const pruned = withStockExpectations(withPrunedAttributes(values));
    if (initial?.status !== "PUBLISHED") return pruned;
    const { slug: _slug, ...rest } = pruned;
    void _slug;
    return rest as CreateProductInput;
  }

  async function persist(status?: ProductStatus) {
    const payload = forSave(form.getValues());
    const { product } = await productsApi.updateProduct(initial!.id, { ...payload, ...(status ? { status } : {}) });
    acknowledgeSavedStock(payload);
    setSaveState("saved");
    setSaveError(null);
    setLastSavedAt(new Date());
    void queryClient.invalidateQueries({ queryKey: ["product-history", initial!.id] });
    return product;
  }

  // Autosave: localStorage before the product exists, a debounced PATCH once it does.
  // What "save the pending edit now" means in each mode; kept current every render for the unmount flush below.
  const flushRef = useRef<() => void>(() => {});
  // Set once the draft exists on the server, so nothing re-saves a local copy of a product that's already created.
  const createdRef = useRef(false);
  flushRef.current = () => {
    if (mode === "edit") void persist().catch(() => {}); // fire-and-forget: the request completes even though this page is gone
    else if (!createdRef.current) writeLocalDraft(form.getValues(), currentStepId);
  };
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStepRef = useRef(currentStepId);
  currentStepRef.current = currentStepId;
  useEffect(() => {
    const sub = form.watch((values) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (mode === "edit") setSaveState("pending");
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (mode === "new") {
          if (!createdRef.current) writeLocalDraft(values as Partial<CreateProductInput>, currentStepRef.current);
          return;
        }
        setSaveState("saving");
        persist()
          .then(() => void queryClient.invalidateQueries({ queryKey: ["product", initial!.id] }))
          // A failed autosave retries on the next edit — the typed values stay in the form, nothing is lost.
          .catch((err) => {
            setSaveState("error");
            setSaveError(describeApiError(err, "the server didn't accept the change"));
          });
      }, AUTOSAVE_DELAY_MS);
    });
    return () => {
      sub.unsubscribe();
      // Leaving the builder inside the app (sidebar link, Back) doesn't fire beforeunload — an edit still waiting for
      // its debounce is sent right away instead of being dropped.
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        flushRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initial?.id]);

  // Leaving with an edit that hasn't reached the server yet asks first.
  const unsaved = mode === "edit" && (saveState === "pending" || saveState === "saving" || saveState === "error");
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  /** Validates with the same resolver every save path uses, and points at the first step with a problem. */
  async function validateAll(): Promise<boolean> {
    const ok = await form.trigger();
    if (ok) return true;
    const failed = Object.keys(form.formState.errors);
    const first = visibleSteps.find((s) => failed.some((f) => stepForField(f, has) === s.id));
    const count = failed.length;
    toast.error(`${count} ${count === 1 ? "field needs" : "fields need"} attention before saving`);
    if (first) goTo(first.id);
    return false;
  }

  /** Save now — and, when given, move the product to `status`. The server re-runs the publish gate; it's the authority. */
  async function saveWithStatus(status?: ProductStatus): Promise<boolean> {
    if (!initial) return false;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!(await validateAll())) return false;
    setBusy(true);
    setSaveState("saving");
    try {
      await persist(status);
      await queryClient.invalidateQueries({ queryKey: ["product", initial.id] });
      setJustPublished(status === "PUBLISHED");
      toast.success(
        status === "PUBLISHED"
          ? "Product published"
          : status === "UNPUBLISHED"
            ? "Product unpublished"
            : status === "READY"
              ? "Marked ready to publish"
              : status === "DRAFT"
                ? "Moved back to draft"
                : "Product saved",
      );
      return true;
    } catch (err) {
      const message = describeApiError(err, "Failed to save");
      setSaveState("error");
      setSaveError(message);
      toast.error(message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Ctrl/Cmd+S saves the product (or nothing, before it exists — the draft is local until created).
  const saveRef = useRef(saveWithStatus);
  saveRef.current = saveWithStatus;
  useEffect(() => {
    if (mode !== "edit") return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode]);

  /* ── creation (new mode) ─────────────────────────────────────────────────────────────────── */

  async function create() {
    if (creating) return;
    // First the minimum every product needs, with a message per missing field…
    const v = form.getValues();
    const missing: { field: keyof CreateProductInput; message: string }[] = [];
    if (!v.name?.trim()) missing.push({ field: "name", message: "Give the product a name" });
    if (!v.categoryId) missing.push({ field: "categoryId", message: "Choose a category" });
    if (!v.typeId) missing.push({ field: "typeId", message: "Choose a product type" });
    if (!v.basePrice || v.basePrice <= 0) missing.push({ field: "basePrice", message: "Enter a price above zero" });
    if (missing.length) {
      for (const m of missing) form.setError(m.field, { type: "required", message: m.message });
      setError(`Before this draft can be created: ${missing.map((m) => m.message.toLowerCase()).join(", ")}.`);
      goTo(stepForField(missing[0]!.field, has));
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // A simple product's single variant gets a real SKU from the pattern now; it stays editable afterwards.
      const first = form.getValues("variants")?.[0];
      if (first && !first.sku && selectedConfig?.typeId) {
        const { sku } = await catalogApi.generateSku({ typeId: selectedConfig.typeId, color: first.color, size: first.size, taken: [] });
        form.setValue("variants.0.sku", sku, { shouldDirty: true });
      }
      // Then the same template-aware validation the server runs on every save (required details, the type's variant
      // options) — every field it checks is on a step reachable before creation, so problems are shown in place.
      if (!(await validateAll())) {
        setCreating(false);
        return;
      }
      const values = withPrunedAttributes(form.getValues());
      const { product } = await productsApi.createProduct({ ...values, status: "DRAFT" });
      createdRef.current = true;
      clearLocalDraft();
      if (stagedImages.length) {
        // The edit page's Media step uploads them one by one with progress and a Retry for any that fail.
        setPendingUploads(product.id, stagedImages.map((s) => s.file));
        toast.success(`"${product.name}" saved as a draft — uploading its photos`);
        router.push(`${productEditHref(product.id)}?step=media`);
      } else {
        toast.success(`"${product.name}" saved as a draft — continue filling it in`);
        router.push(productEditHref(product.id));
      }
      // `creating` stays set until the edit page replaces this one, so a second click can't create a duplicate draft.
    } catch (err) {
      setError(describeApiError(err, "Failed to create product"));
      setCreating(false);
    }
  }

  const isCreateStep = mode === "new" && currentStepId === lastPreCreateStepId;
  function next() {
    if (isCreateStep) return void create();
    const target = visibleSteps[currentIndex + 1];
    if (target) goTo(target.id);
  }
  function back() {
    const target = visibleSteps[currentIndex - 1];
    if (target) goTo(target.id);
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

  const fix = useCallback((key: CompletenessCheckKey) => goTo(stepForCheck(key, has)), [goTo, has]);

  const actions: WizardActions = { fix, goTo, saveWithStatus, busy, justPublished, applySlug, applyingSlug };

  /* ── live preview ───────────────────────────────────────────────────────────────────────── */

  // Same query keys CareMaterialSection uses — these are lists it already loaded, nothing extra is fetched.
  const { data: careData } = useQuery({ queryKey: ["catalog-care-guides"], queryFn: catalogApi.listCareGuides });
  const { data: materialsData } = useQuery({ queryKey: ["catalog-materials"], queryFn: catalogApi.listMaterials });
  const liveValues = form.watch();
  const previewProduct = resolvePreviewProduct(
    liveValues,
    { config: selectedConfig ?? null, resolvedSections, categories, careGuides: careData?.careGuides ?? [], materials: materialsData?.materials ?? [] },
    {
      initial,
      // Before creation the photos only exist in this browser (staged object URLs) — the preview shows them anyway.
      images: initial ? initial.images : stagedImages.map((s, i) => ({ id: s.key, productId: "preview", url: s.previewUrl, altText: null, sortOrder: i })),
    },
  );

  return {
    mode,
    initial,
    categories,
    state,
    steps,
    currentStep,
    currentIndex,
    isCreateStep,
    goTo,
    next,
    back,
    creating,
    error,
    saveState,
    saveError,
    lastSavedAt,
    busy,
    actions,
    recovery,
    resumeDraft,
    discardDraft,
    relationNames,
    addRelationNames: (added: Record<string, string>) => setRelationNames((prev) => ({ ...prev, ...added })),
    previewProduct,
    completeness,
    productName: liveValues.name as string | undefined,
  };
}

export type ProductBuilderController = ReturnType<typeof useProductBuilder>;
