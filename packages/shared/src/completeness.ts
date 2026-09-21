import { COMPLETENESS_CHECKS, type CompletenessCheckKey } from "./completeness-checks";
import { isBlankAttributeValue, type ResolvedTypeConfig } from "./schemas/catalog";

export { COMPLETENESS_CHECKS, COMPLETENESS_CHECK_KEYS, OPTIONAL_COMPLETENESS_KEYS, type CompletenessCheckKey } from "./completeness-checks";

export type CheckStatus = "ok" | "missing" | "na";

export interface CompletenessCheck {
  key: CompletenessCheckKey;
  label: string;
  hint: string;
  status: CheckStatus;
  required: boolean;
  /** What exactly is missing, when the check can say. */
  detail?: string;
}

export interface CompletenessResult {
  /** 0–100 over the checks that apply to this product ("na" ones don't count). */
  score: number;
  checks: CompletenessCheck[];
  /** Required checks that are missing — a product with any of these can't move to READY or PUBLISHED. */
  blockers: CompletenessCheck[];
}

export interface CompletenessInput {
  name?: string | null;
  categoryId?: string | null;
  basePrice?: number | string | null;
  description?: string | null;
  seoDescription?: string | null;
  trackInventory?: boolean;
  variants: { sku?: string | null; size?: string | null; color?: string | null; stock?: number | null }[];
  imageCount: number;
  attributes?: Record<string, unknown> | null;
  materialCount: number;
  hasCare: boolean;
  /** Whether the product page will offer a size guide; null when the type has none at all. */
  sizeGuideShown: boolean | null;
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Scores a product against its type's template. Pure: the API runs it on the saved product to gate publishing,
 * and the editor runs it on the live form values to show the meter — same rules in both places. */
export function computeCompleteness(
  input: CompletenessInput,
  config: Pick<ResolvedTypeConfig, "fields" | "variantDimensions" | "requiredChecks"> | null,
): CompletenessResult {
  const attrs = input.attributes ?? {};
  const sizeDim = config?.variantDimensions.find((d) => d.targetField === "size");
  const colorDim = config?.variantDimensions.find((d) => d.targetField === "color");
  const price = Number(input.basePrice);

  const badVariants = input.variants.filter(
    (v) =>
      !v.sku?.trim() ||
      (sizeDim && !v.size?.trim()) ||
      (colorDim && !v.color?.trim()),
  ).length;
  const missingAttributes = (config?.fields ?? []).filter((f) => f.required && isBlankAttributeValue(attrs[f.key])).map((f) => f.label);
  const totalStock = input.variants.reduce((sum, v) => sum + (v.stock ?? 0), 0);

  const results: Record<CompletenessCheckKey, { ok: boolean; detail?: string } | "na"> = {
    basics: { ok: Boolean(input.name?.trim() && input.categoryId), detail: !input.name?.trim() ? "Add a name" : !input.categoryId ? "Choose a category" : undefined },
    pricing: { ok: Number.isFinite(price) && price > 0, detail: "Set a base price" },
    variants: {
      ok: input.variants.length > 0 && badVariants === 0,
      detail: input.variants.length === 0 ? "Add a variant" : `${badVariants} variant(s) missing a SKU or option`,
    },
    images: { ok: input.imageCount > 0, detail: "Upload at least one image" },
    attributes: { ok: missingAttributes.length === 0, detail: `Fill in: ${missingAttributes.join(", ")}` },
    inventory: { ok: input.trackInventory === false || totalStock > 0, detail: "No stock on any variant" },
    description: { ok: stripTags(input.description ?? "").length > 0, detail: "Write a description" },
    seo: { ok: Boolean(input.seoDescription?.trim()), detail: "Add a meta description" },
    sizeGuide: input.sizeGuideShown === null ? "na" : { ok: input.sizeGuideShown, detail: "Enable a size guide" },
    material: { ok: input.materialCount > 0 || !isBlankAttributeValue(attrs.material), detail: "Add at least one material" },
    care: { ok: input.hasCare, detail: "Choose or write care instructions" },
  };

  const requiredByTemplate = new Set(config?.requiredChecks ?? []);
  const checks: CompletenessCheck[] = COMPLETENESS_CHECKS.map((def) => {
    const r = results[def.key];
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      status: r === "na" ? "na" : r.ok ? "ok" : "missing",
      required: def.alwaysRequired || requiredByTemplate.has(def.key),
      detail: r !== "na" && !r.ok ? r.detail : undefined,
    };
  });

  const scored = checks.filter((c) => c.status !== "na");
  const ok = scored.filter((c) => c.status === "ok").length;
  return {
    score: scored.length === 0 ? 100 : Math.round((ok / scored.length) * 100),
    checks,
    blockers: checks.filter((c) => c.required && c.status === "missing"),
  };
}

/** Human list for error messages and the publish dialog: "Images, Required details". */
export const describeBlockers = (result: CompletenessResult) => result.blockers.map((b) => b.label).join(", ");
