import { useEffect, useMemo, useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import {
  computeCompleteness,
  createProductSchema,
  resolveSections,
  validateProductAgainstConfig,
  type Category,
  type CreateProductInput,
  type Product,
  type ProductStatus,
  type ResolvedTypeConfig,
  type SectionOverrideInput,
} from "@clothing-brand/shared";
import { layerOf } from "./section-settings-editor";
import type { StagedImage } from "./image-uploader";
import * as attributesApi from "@/lib/api/attributes";
import * as catalogApi from "@/lib/api/catalog";
import * as aiApi from "@/lib/api/ai";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

/** Flattens the category tree into a top-level-first, indented option list (e.g. "— Cap" under
 * "Accessories") so the admin can see hierarchy in a single-select dropdown without a second field. */
export function buildCategoryOptions(categories: Category[]) {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(c);
  }
  for (const group of byParent.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  const options: { id: string; label: string }[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const c of byParent.get(parentId) ?? []) {
      options.push({ id: c.id, label: `${"— ".repeat(depth)}${c.name}` });
      walk(c.id, depth + 1);
    }
  }
  walk(null, 0);
  return options;
}

/** Sets `value` at a nested path, creating containers as needed — used to add template-validation errors
 * next to the ones zod already produced, in the shape react-hook-form reads them (errors.attributes.fit). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setNestedError(target: Record<string, any>, path: (string | number)[], value: unknown) {
  let node = target;
  path.slice(0, -1).forEach((key) => {
    node[key] ??= {};
    node = node[key];
  });
  node[path[path.length - 1]!] = value;
}

/** zod checks the payload's shape; the product type's template (fetched, so it can be data) adds the rules
 * zod can't know — required attributes, option lists, per-type variant dimensions. Shared by the tabbed
 * ProductForm and the step-by-step wizard so a product is validated the same way in both. */
export function buildResolver(getConfig: () => ResolvedTypeConfig | undefined): Resolver<CreateProductInput> {
  const zod = zodResolver(createProductSchema);
  return async (values, context, options) => {
    const result = await zod(values, context, options);
    const config = getConfig();
    const issues = config
      ? validateProductAgainstConfig({ attributes: values.attributes, variants: values.variants }, config)
      : [{ path: ["typeId"], message: "Select a product type" }];
    if (issues.length === 0) return result;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errors: Record<string, any> = "errors" in result ? { ...(result.errors as object) } : {};
    for (const issue of issues) setNestedError(errors, issue.path, { type: "validate", message: issue.message });
    return { values: {}, errors } as never;
  };
}

/** Keeps only the attribute keys the server will accept: the selected type's fields, the size guide, and
 * legacy keys this product already had that no type defines. Fields of the type it just left are dropped
 * from the payload on purpose — the server keeps those values (hidden), so switching back restores them. */
export function pruneAttributes(
  attributes: Record<string, unknown> | null | undefined,
  config: ResolvedTypeConfig,
  allFieldKeys: Set<string>,
  initialKeys: Set<string>,
) {
  const fieldKeys = new Set(config.fields.map((f) => f.key));
  return Object.fromEntries(
    Object.entries(attributes ?? {}).filter(
      ([key]) => fieldKeys.has(key) || key === "sizeGuide" || (initialKeys.has(key) && !allFieldKeys.has(key)),
    ),
  );
}

function defaultValuesFor(initial?: Product): Partial<CreateProductInput> {
  if (!initial) {
    return {
      typeId: "",
      attributes: {},
      brandTier: "PREMIUM",
      isFeatured: false,
      carePresetId: "",
      careOverride: [],
      materials: [],
      sections: [],
      faqs: [],
      relations: [],
      trackInventory: true,
      lowStockThreshold: 5,
      sortOrder: 0,
      variants: [{ sku: "", size: "", color: "", stock: 0, isActive: true, attributeValueIds: [] }],
    };
  }
  return {
    name: initial.name,
    slug: initial.slug,
    description: initial.description,
    shortDescription: initial.shortDescription,
    sortOrder: initial.sortOrder,
    categoryId: initial.categoryId,
    // Without these the form would re-submit a default type and blank spec fields, so saving
    // any edit would reset the product's type and wipe its attributes.
    typeId: initial.typeId ?? initial.resolved?.type?.id ?? "",
    attributes: initial.attributes ?? {},
    brand: initial.brand,
    brandTier: initial.brandTier,
    basePrice: Number(initial.basePrice),
    compareAtPrice: initial.compareAtPrice ? Number(initial.compareAtPrice) : undefined,
    costPrice: initial.costPrice ? Number(initial.costPrice) : undefined,
    taxRate: initial.taxRate ? Number(initial.taxRate) : undefined,
    trackInventory: initial.trackInventory,
    lowStockThreshold: initial.lowStockThreshold,
    isFeatured: initial.isFeatured,
    seoTitle: initial.seoTitle,
    seoDescription: initial.seoDescription,
    focusKeyword: initial.focusKeyword,
    ogTitle: initial.ogTitle,
    ogDescription: initial.ogDescription,
    ogImageUrl: initial.ogImageUrl,
    canonicalUrl: initial.canonicalUrl,
    carePresetId: initial.carePresetId ?? "",
    careOverride: initial.careOverride ?? [],
    materials: initial.materials ?? [],
    sections: (initial.sectionOverrides ?? []) as SectionOverrideInput[],
    faqs: initial.faqs ?? [],
    relations: (initial.relations ?? []).map((r) => ({ kind: r.kind, productIds: r.productIds })),
    variants: initial.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      sizeLabel: v.sizeLabel,
      color: v.color,
      colorHex: v.colorHex,
      price: v.price ? Number(v.price) : undefined,
      compareAtPrice: v.compareAtPrice ? Number(v.compareAtPrice) : undefined,
      costPrice: v.costPrice ? Number(v.costPrice) : undefined,
      stock: v.stock,
      weight: v.weight ? Number(v.weight) : undefined,
      isActive: v.isActive ?? true,
      imageId: v.imageId,
      // The variant's own gallery, in order (falling back to its single legacy image).
      imageIds: v.images?.length ? [...v.images].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.imageId) : v.imageId ? [v.imageId] : [],
      attributeValueIds: (v.attributeValues ?? []).map((av) => av.attributeValueId),
    })),
  };
}

export interface UseProductFormStateOptions {
  initial?: Product;
  stagedImages?: StagedImage[];
}

/** Everything a product editor UI (the tabbed ProductForm, or the step-by-step wizard) needs: the
 * react-hook-form instance (config-driven validation via buildResolver), the fetched type/attribute/
 * category reference data, the currently-selected type's resolved config, this product's resolved page
 * sections, and the live completeness score — computed exactly the way the server gates publishing.
 * One source of truth so the two UIs can never drift on what's required or what's complete. */
export function useProductFormState({ initial, stagedImages }: UseProductFormStateOptions) {
  const { data: typesData } = useQuery({ queryKey: ["catalog-types", "all"], queryFn: () => catalogApi.listTypes(true) });
  const types = useMemo(() => typesData?.types ?? [], [typesData]);
  const { data: attributesData } = useQuery({ queryKey: ["attributes"], queryFn: attributesApi.listAttributes });
  const attributes = attributesData?.attributes ?? [];

  const { data: aiStatus } = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.getAiStatus });
  // AI generation is OWNER-only on the backend (it bills real API usage) — hide the entry points
  // for STAFF rather than showing a button that always 403s.
  const { data: currentAdmin } = useCurrentAdmin();
  const canUseAi = Boolean(aiStatus?.configured && currentAdmin?.admin.role === "OWNER");

  const selectedConfigRef = useRef<ResolvedTypeConfig | undefined>(undefined);
  // The store-wide section layer, so the product's section editor can say what a blank field inherits.
  const { data: globalSections } = useQuery({ queryKey: ["catalog-sections"], queryFn: catalogApi.getGlobalSections });

  const form = useForm<CreateProductInput>({
    resolver: buildResolver(() => selectedConfigRef.current),
    defaultValues: defaultValuesFor(initial),
  });
  const { watch, setValue, formState } = form;

  const typeId = watch("typeId");
  const selectedConfig = types.find((t) => t.typeId === typeId);
  selectedConfigRef.current = selectedConfig;
  const allFieldKeys = new Set(types.flatMap((t) => t.fields.map((f) => f.key)));
  const initialAttributeKeys = new Set(Object.keys(initial?.attributes ?? {}));

  // A new product starts on the first active type (Clothing, unless an admin reordered them).
  useEffect(() => {
    if (!initial && !typeId) {
      const first = types.find((t) => t.isActive);
      if (first) setValue("typeId", first.typeId);
    }
  }, [initial, typeId, types, setValue]);

  const live = watch();
  const savedSizeGuide = (live.attributes as Record<string, unknown> | null | undefined)?.sizeGuide as { enabled?: boolean } | undefined;
  // Same store → template → product resolution the section editor and the storefront use, so "this section is
  // off" means the same thing here as it does everywhere else.
  const resolvedSections = resolveSections({
    global: layerOf((globalSections?.overrides ?? []) as SectionOverrideInput[]),
    template: layerOf((selectedConfig?.sectionOverrides ?? []) as SectionOverrideInput[]),
    product: layerOf((live.sections ?? []) as SectionOverrideInput[]),
  });
  const sectionEnabled = (key: string) => resolvedSections.find((s) => s.key === key)?.enabled ?? true;

  const completeness = computeCompleteness(
    {
      name: live.name,
      categoryId: live.categoryId,
      basePrice: live.basePrice,
      description: live.description,
      seoDescription: live.seoDescription,
      trackInventory: live.trackInventory,
      variants: live.variants ?? [],
      // Images live outside this form: saved ones on the edit page, staged ones (uploaded after create) on the new page.
      imageCount: initial ? initial.images.length : (stagedImages?.length ?? 0),
      attributes: live.attributes,
      materialCount: (live.materials ?? []).filter((m) => m?.materialId || m?.customName).length,
      hasCare: (live.careOverride?.length ?? 0) > 0 || Boolean(live.carePresetId) || (selectedConfig?.care.steps.length ?? 0) > 0,
      sizeGuideShown:
        !selectedConfig || selectedConfig.sizeGuide.mode === "NOT_APPLICABLE"
          ? null
          : savedSizeGuide
            ? savedSizeGuide.enabled === true
            : selectedConfig.sizeGuide.mode === "ON_BY_DEFAULT",
      materialEnabled: sectionEnabled("material"),
      careEnabled: sectionEnabled("care"),
    },
    selectedConfig ?? null,
  );

  /** Prunes attribute keys the current type doesn't own before sending — call this on whatever values
   * are about to be submitted (a full submit, or a wizard step's partial autosave). */
  function withPrunedAttributes(values: CreateProductInput): CreateProductInput {
    return selectedConfig
      ? { ...values, attributes: pruneAttributes(values.attributes, selectedConfig, allFieldKeys, initialAttributeKeys) }
      : values;
  }

  return {
    form,
    initial,
    types,
    attributes,
    canUseAi,
    globalSections,
    selectedConfig,
    resolvedSections,
    sectionEnabled,
    completeness,
    withPrunedAttributes,
    formState,
    typeId,
  };
}

export type ProductFormState = ReturnType<typeof useProductFormState>;
export type { ProductStatus };
