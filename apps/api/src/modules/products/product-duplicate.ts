import {
  resolveDuplicateOptions,
  type CreateProductInput,
  type DuplicateProductInput,
  type DuplicateProductResult,
  type ProductRelationsInput,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { recordAudit } from "../../lib/audit";
import { getTypeByKey, getTypeWithTemplate } from "../catalog/catalog.service";
import { toResolvedTypeConfig } from "../catalog/catalog.presenter";
import { generateSku } from "../catalog/sku.service";
import { copyProductImageFiles, deleteProductImageFiles } from "../uploads/upload.service";
import { createProduct, getProductById, invalidateCache } from "./product.service";

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(String(v)));

/** Creates a draft copy of a product, bringing over what the admin ticked (see DUPLICATE_COPY_OPTIONS).
 *
 * The copy goes through `createProduct`, so it is validated by exactly the rules a hand-made product is: the type's
 * required fields, variant dimensions, material and care checks. Unique things are never copied — every variant gets a
 * freshly generated SKU, barcodes are dropped, the slug is derived from the new name. Stock starts at 0 unless asked for.
 * Images are copied as files, so the two products own separate photos. */
export async function duplicateProduct(sourceId: string, input: DuplicateProductInput, adminId: string, ip?: string): Promise<DuplicateProductResult> {
  const source = await getProductById(sourceId);
  if (source.deletedAt) throw AppError.badRequest("This product is in Trash. Restore it before duplicating it.");

  const opts = resolveDuplicateOptions(input.copy);
  const warnings: string[] = [];
  const name = input.name ?? `${source.name} (copy)`;

  const type = source.typeId ? await getTypeWithTemplate(source.typeId).catch(() => null) : await getTypeByKey(source.productType);
  if (!type) throw AppError.badRequest("This product's type no longer exists, so it can't be duplicated");
  const config = toResolvedTypeConfig(type);

  // Attributes: the type's own fields and the size guide. Values left over from an older type aren't accepted on create.
  const fieldKeys = new Set(config.fields.map((f) => f.key));
  const attributes = Object.fromEntries(Object.entries(source.attributes).filter(([k]) => fieldKeys.has(k) || k === "sizeGuide"));
  const dropped = Object.keys(source.attributes).filter((k) => !fieldKeys.has(k) && k !== "sizeGuide");
  if (dropped.length) warnings.push(`${dropped.length} older detail(s) that this product type doesn't define weren't copied: ${dropped.join(", ")}`);

  // Variants: same options and prices, new SKUs (one generated per variant, unique among themselves and the database).
  const sourceVariants = [...source.variants].sort((a, b) => a.sortOrder - b.sortOrder);
  const taken: string[] = [];
  const variants: CreateProductInput["variants"] = [];
  for (const v of sourceVariants) {
    const sku = await generateSku({ typeId: type.id, color: v.color, size: v.size, taken });
    taken.push(sku);
    variants.push({
      sku,
      size: v.size,
      sizeLabel: v.sizeLabel,
      color: v.color,
      colorHex: v.colorHex,
      price: num(v.price),
      compareAtPrice: num(v.compareAtPrice),
      costPrice: num(v.costPrice),
      weight: num(v.weight),
      isActive: v.isActive,
      stock: opts.stock ? v.stock : 0,
      attributeValueIds: v.attributeValues.map((av) => av.attributeValueId),
    });
  }

  // Materials and care: an archived material or care guide can't be attached to a new product, so it is carried over as text.
  let materials: CreateProductInput["materials"];
  let carePresetId: string | null | undefined;
  let careOverride: string[] | null | undefined;
  if (opts.materialsAndCare) {
    const names = source.resolved.materials.map((m) => m.name);
    const ids = source.materials.map((m) => m.materialId).filter((x): x is string => Boolean(x));
    const archived = new Set((await prisma.material.findMany({ where: { id: { in: ids }, isArchived: true }, select: { id: true } })).map((m) => m.id));
    materials = source.materials.map((m, i) => {
      if (m.materialId && archived.has(m.materialId)) {
        warnings.push(`The material "${names[i]}" is archived, so it was copied as plain text.`);
        return { customName: names[i]!, percentage: m.percentage };
      }
      return m.materialId ? { materialId: m.materialId, percentage: m.percentage } : { customName: m.customName, percentage: m.percentage };
    });
    careOverride = (source.careOverride as string[] | null) ?? undefined;
    carePresetId = source.carePresetId;
    if (carePresetId) {
      const preset = await prisma.careGuidePreset.findUnique({ where: { id: carePresetId }, select: { isArchived: true, name: true, steps: true } });
      if (preset?.isArchived) {
        warnings.push(`The care guide "${preset.name}" is archived, so its steps were copied as this product's own care steps.`);
        careOverride = careOverride?.length ? careOverride : (preset.steps as string[]);
        carePresetId = null;
      }
    }
  }

  let relations: CreateProductInput["relations"];
  if (opts.relations && source.relations.length) {
    const ids = [...new Set(source.relations.flatMap((r) => r.productIds))];
    const live = new Set((await prisma.product.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } })).map((p) => p.id));
    relations = source.relations.map((r) => ({ kind: r.kind as ProductRelationsInput[number]["kind"], productIds: r.productIds.filter((id) => live.has(id)) })).filter((r) => r.productIds.length);
    if (ids.some((id) => !live.has(id))) warnings.push("Some hand-picked related products no longer exist and were left out.");
  }

  const created = await createProduct(
    {
      name,
      description: source.description,
      shortDescription: source.shortDescription,
      sortOrder: source.sortOrder,
      categoryId: source.categoryId,
      typeId: type.id,
      attributes,
      brand: source.brand,
      brandTier: source.brandTier,
      basePrice: Number(String(source.basePrice)),
      compareAtPrice: num(source.compareAtPrice),
      costPrice: num(source.costPrice),
      taxRate: num(source.taxRate),
      trackInventory: source.trackInventory,
      lowStockThreshold: source.lowStockThreshold,
      restockDate: source.restockDate ?? undefined,
      status: "DRAFT",
      isFeatured: false,
      ...(opts.seo
        ? {
            seoTitle: source.seoTitle,
            seoDescription: source.seoDescription,
            focusKeyword: source.focusKeyword,
            ogTitle: source.ogTitle,
            ogDescription: source.ogDescription,
            ogImageUrl: source.ogImageUrl,
          }
        : {}),
      ...(opts.materialsAndCare ? { materials, carePresetId, careOverride } : {}),
      ...(opts.sections ? { sections: source.sectionOverrides.map(({ sectionKey, enabled, sortOrder, title, content }) => ({ sectionKey, enabled, sortOrder, title, content })) as CreateProductInput["sections"] } : {}),
      ...(opts.faqs ? { faqs: source.faqs } : {}),
      ...(relations ? { relations } : {}),
      variants,
    },
    adminId,
    ip,
  );

  const copied: Record<string, number> = { variants: variants.length };
  if (source.faqs.length && opts.faqs) copied.faqs = source.faqs.length;
  if (source.sectionOverrides.length && opts.sections) copied.sections = source.sectionOverrides.length;
  if (materials?.length) copied.materials = materials.length;
  if (relations?.length) copied.relatedLists = relations.length;

  if (opts.images && source.images.length) {
    const made: string[] = []; // new "full" URLs whose files we created, to clean up if a later step fails
    try {
      const imageCount = await copyImages(source, created, made, warnings);
      copied.images = imageCount;
    } catch (err) {
      // Nothing half-made is left behind: the new product and any copied files go.
      await prisma.product.delete({ where: { id: created.id } }).catch(() => undefined);
      await Promise.all(made.map((url) => deleteProductImageFiles(url)));
      throw err;
    }
  }

  await invalidateCache({ productId: created.id, slug: created.slug });
  recordAudit({
    adminId,
    action: "product.duplicated",
    entityType: "products",
    entityId: created.id,
    ipAddress: ip ?? null,
    metadata: { changes: [{ field: "duplicated from", from: null, to: source.name }, { field: "copied", from: null, to: describeCopied(copied) }] },
  });
  recordAudit({
    adminId,
    action: "product.copied",
    entityType: "products",
    entityId: source.id,
    ipAddress: ip ?? null,
    metadata: { changes: [{ field: "duplicated as", from: null, to: created.name }] },
  });

  return { productId: created.id, slug: created.slug, name: created.name, copied, warnings };
}

type Source = Awaited<ReturnType<typeof getProductById>>;

/** Copies the image files and rows, then rebuilds each variant's gallery on the new images. Returns how many images came across. */
async function copyImages(source: Source, created: Source, made: string[], warnings: string[]): Promise<number> {
  const sourceImages = [...source.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const kept: { oldId: string; url: string; image: (typeof sourceImages)[number] }[] = [];
  for (const image of sourceImages) {
    const copy = await copyProductImageFiles(image.url);
    if (copy.kind === "missing") {
      warnings.push(`An image (${image.altText || "no alt text"}) is missing from storage and wasn't copied.`);
      continue;
    }
    if (copy.kind === "copied") made.push(copy.url);
    kept.push({ oldId: image.id, url: copy.url, image });
  }
  if (!kept.length) return 0;

  const idMap = new Map<string, string>();
  const sourceVariants = [...source.variants].sort((a, b) => a.sortOrder - b.sortOrder);
  const newVariants = [...created.variants].sort((a, b) => a.sortOrder - b.sortOrder);

  await prisma.$transaction(async (tx) => {
    for (const [index, { oldId, url, image }] of kept.entries()) {
      const row = await tx.productImage.create({
        data: { productId: created.id, url, altText: image.altText, caption: image.caption, width: image.width, height: image.height, sortOrder: index },
      });
      idMap.set(oldId, row.id);
    }
    // The new variants were created in the source's order, so they line up one to one.
    for (const [i, from] of sourceVariants.entries()) {
      const to = newVariants[i];
      if (!to) continue;
      const gallery = (from.images.length ? [...from.images].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => g.imageId) : from.imageId ? [from.imageId] : [])
        .map((oldId) => idMap.get(oldId))
        .filter((id): id is string => Boolean(id));
      if (!gallery.length) continue;
      await tx.variantImage.createMany({ data: gallery.map((imageId, sortOrder) => ({ variantId: to.id, imageId, sortOrder })) });
      await tx.productVariant.update({ where: { id: to.id }, data: { imageId: gallery[0] } });
    }
  });
  return kept.length;
}

function describeCopied(copied: Record<string, number>) {
  return Object.entries(copied)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
}
