/** Turns "product before" vs "product after" into the handful of meaningful events an admin wants in the
 * history ("Price changed", "Published", "Size guide changed"), each with what actually changed. Pure — the
 * service feeds it two presented products and records whatever comes out. */

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditEvent {
  action: string;
  changes: AuditChange[];
}

/** The slice of a presented product the diff looks at. */
export interface AuditSnapshot {
  name: string;
  slug: string;
  categoryId: string;
  typeId: string | null;
  brand: string | null;
  brandTier: string;
  shortDescription: string | null;
  description: string;
  basePrice: unknown;
  compareAtPrice: unknown;
  costPrice: unknown;
  taxRate: unknown;
  trackInventory: boolean;
  lowStockThreshold: number;
  isFeatured: boolean;
  sortOrder: number;
  status: string;
  seoTitle: string | null;
  seoDescription: string | null;
  focusKeyword?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  carePresetId?: string | null;
  careOverride?: unknown;
  attributes: Record<string, unknown>;
  materials?: { materialId: string | null; customName: string | null; percentage: unknown }[];
  variants: {
    id: string;
    sku: string;
    size: string;
    color: string;
    price: unknown;
    compareAtPrice?: unknown;
    isActive?: boolean;
    images?: { imageId: string; sortOrder: number }[];
    stock: number;
  }[];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const short = (v: unknown) => (typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function pick(before: AuditSnapshot, after: AuditSnapshot, fields: (keyof AuditSnapshot)[], normalise: (v: unknown) => unknown = (v) => v): AuditChange[] {
  return fields
    .filter((f) => !same(normalise(before[f]), normalise(after[f])))
    .map((f) => ({ field: f, from: short(normalise(before[f])), to: short(normalise(after[f])) }));
}

export function diffProduct(before: AuditSnapshot, after: AuditSnapshot): AuditEvent[] {
  const events: AuditEvent[] = [];
  const push = (action: string, changes: AuditChange[]) => {
    if (changes.length) events.push({ action, changes });
  };

  // Status: one specific event for publish / unpublish, a generic one for anything else.
  if (before.status !== after.status) {
    const action =
      after.status === "PUBLISHED" ? "product.published" : before.status === "PUBLISHED" ? "product.unpublished" : "product.status_changed";
    push(action, [{ field: "status", from: before.status, to: after.status }]);
  }

  // Price: the product's own prices plus any variant price override.
  const priceChanges = pick(before, after, ["basePrice", "compareAtPrice", "costPrice", "taxRate"], num);
  // Matched by variant id, so renaming a SKU reads as a rename, not as one variant removed and another added.
  const byId = new Map(before.variants.map((v) => [v.id, v]));
  for (const v of after.variants) {
    const old = byId.get(v.id);
    if (old && num(old.price) !== num(v.price)) priceChanges.push({ field: `variant ${v.sku} price`, from: num(old.price), to: num(v.price) });
    if (old && num(old.compareAtPrice) !== num(v.compareAtPrice)) priceChanges.push({ field: `variant ${v.sku} compare-at price`, from: num(old.compareAtPrice), to: num(v.compareAtPrice) });
  }
  push("product.price_changed", priceChanges);

  // Stock: per variant, by SKU.
  const stockChanges: AuditChange[] = [];
  for (const v of after.variants) {
    const old = byId.get(v.id);
    if (old && old.stock !== v.stock) stockChanges.push({ field: `variant ${v.sku} stock`, from: old.stock, to: v.stock });
  }
  push("product.stock_changed", stockChanges);

  // Variants added / removed / re-keyed.
  const afterIds = new Set(after.variants.map((v) => v.id));
  const variantChanges: AuditChange[] = [
    ...after.variants.filter((v) => !byId.has(v.id)).map((v) => ({ field: "variant added", from: null, to: `${v.sku} (${[v.size, v.color].filter(Boolean).join(" / ")})` })),
    ...before.variants.filter((v) => !afterIds.has(v.id)).map((v) => ({ field: "variant removed", from: v.sku, to: null })),
    ...after.variants.flatMap((v) => {
      const old = byId.get(v.id);
      if (!old) return [];
      const changes: AuditChange[] = [];
      if (old.sku !== v.sku) changes.push({ field: "variant SKU", from: old.sku, to: v.sku });
      if ((old.isActive ?? true) !== (v.isActive ?? true)) changes.push({ field: `variant ${v.sku} active`, from: old.isActive ?? true, to: v.isActive ?? true });
      const gallery = (x: typeof v) => (x.images ?? []).map((i) => i.imageId).join(",");
      if (gallery(old) !== gallery(v)) {
        changes.push({ field: `variant ${v.sku} images`, from: `${old.images?.length ?? 0} image(s)`, to: `${v.images?.length ?? 0} image(s)` });
      }
      return changes;
    }),
  ];
  push("product.variants_changed", variantChanges);

  if (before.description !== after.description) {
    push("product.description_updated", [{ field: "description", from: `${before.description.length} characters`, to: `${after.description.length} characters` }]);
  }

  const { sizeGuide: beforeGuide, ...beforeAttrs } = before.attributes;
  const { sizeGuide: afterGuide, ...afterAttrs } = after.attributes;
  if (!same(beforeGuide, afterGuide)) {
    push("product.size_guide_changed", [{ field: "sizeGuide", from: beforeGuide ? "custom size guide" : "type default", to: afterGuide ? "custom size guide" : "type default" }]);
  }
  const attrChanges: AuditChange[] = [];
  for (const key of new Set([...Object.keys(beforeAttrs), ...Object.keys(afterAttrs)])) {
    if (!same(beforeAttrs[key], afterAttrs[key])) attrChanges.push({ field: key, from: short(beforeAttrs[key] ?? null), to: short(afterAttrs[key] ?? null) });
  }
  push("product.attributes_updated", attrChanges);

  push("product.seo_updated", pick(before, after, ["seoTitle", "seoDescription", "focusKeyword", "ogTitle", "ogDescription", "ogImageUrl", "canonicalUrl", "slug"]));
  push("product.care_updated", pick(before, after, ["carePresetId", "careOverride"]));

  const materialSig = (s: AuditSnapshot) => (s.materials ?? []).map((m) => `${m.materialId ?? m.customName}:${num(m.percentage) ?? ""}`);
  if (!same(materialSig(before), materialSig(after))) {
    push("product.materials_updated", [{ field: "materials", from: materialSig(before).join(", ") || null, to: materialSig(after).join(", ") || null }]);
  }

  push("product.details_updated", pick(before, after, ["name", "categoryId", "typeId", "brand", "brandTier", "shortDescription", "trackInventory", "lowStockThreshold", "isFeatured", "sortOrder"]));

  return events;
}
