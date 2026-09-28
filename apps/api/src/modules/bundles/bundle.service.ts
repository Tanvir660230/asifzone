import type { CreateBundleInput, UpdateBundleInput, BundleListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { getRecommendedByCategories } from "../products/product.service";
import { PURCHASABLE_PRODUCT_WHERE } from "../products/product-public-select";
import { toMajor } from "@clothing-brand/shared";
import { quoteCart } from "../../domain/pricing/pricing.service";

const include = {
  anchorCategory: true,
  suggestions: { include: { category: true }, orderBy: { sortOrder: "asc" as const } },
};

export async function listBundles(query: BundleListQuery) {
  return paginate(
    query,
    (p) => prisma.bundle.findMany({ include, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], ...p }),
    () => prisma.bundle.count(),
  );
}

export async function getBundleById(id: string) {
  const bundle = await prisma.bundle.findUnique({ where: { id }, include });
  if (!bundle) throw AppError.notFound("Bundle not found");
  return bundle;
}

function toSuggestionCreateData(categoryIds: string[]) {
  return categoryIds.map((categoryId, i) => ({ categoryId, sortOrder: i }));
}

export async function createBundle(input: CreateBundleInput) {
  const anchor = await prisma.category.findUnique({ where: { id: input.anchorCategoryId } });
  if (!anchor) throw AppError.badRequest("Anchor category does not exist");

  const { suggestionCategoryIds, ...rest } = input;
  return prisma.bundle.create({
    data: { ...rest, suggestions: { create: toSuggestionCreateData(suggestionCategoryIds) } },
    include,
  });
}

export async function updateBundle(id: string, input: UpdateBundleInput) {
  await getBundleById(id);

  if (input.anchorCategoryId) {
    const anchor = await prisma.category.findUnique({ where: { id: input.anchorCategoryId } });
    if (!anchor) throw AppError.badRequest("Anchor category does not exist");
  }

  const { suggestionCategoryIds, ...rest } = input;

  await prisma.$transaction(async (tx) => {
    await tx.bundle.update({ where: { id }, data: rest });
    if (suggestionCategoryIds) {
      await tx.bundleSuggestion.deleteMany({ where: { bundleId: id } });
      await tx.bundleSuggestion.createMany({
        data: suggestionCategoryIds.map((categoryId, i) => ({ bundleId: id, categoryId, sortOrder: i })),
      });
    }
  });

  return getBundleById(id);
}

export async function deleteBundle(id: string) {
  await getBundleById(id);
  await prisma.bundle.delete({ where: { id } });
}

const SUGGESTED_PRODUCTS_LIMIT = 8;

/** The active bundle (if any) anchored on this product's category, plus live products drawn from
 * its suggestion categories — powers the PDP's "Complete the Bundle" section. */
export async function getBundleForProduct(productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, ...PURCHASABLE_PRODUCT_WHERE }, select: { categoryId: true } });
  if (!product) return null;

  const bundle = await prisma.bundle.findFirst({
    where: { anchorCategoryId: product.categoryId, isActive: true },
    include,
    orderBy: { sortOrder: "asc" },
  });
  if (!bundle) return null;

  const suggestedProducts = await getRecommendedByCategories(
    bundle.suggestions.map((s) => s.categoryId),
    { exclude: productId, limit: SUGGESTED_PRODUCTS_LIMIT },
  );

  return { bundle, suggestedProducts };
}

/** Storefront bundle preview — the applied bundle and the closest near-miss, straight from the canonical quote (the
 * promotion engine prices bundles on the post-flash amounts, D2). No bundle math lives here. Kept for clients that
 * still call /api/bundles/preview; the cart and checkout read the same facts from the quote itself. */
export async function getBundleCartPreview(items: { variantId: string; quantity: number }[]) {
  const { quote } = await quoteCart({ items });
  const ids = [quote.bundle?.bundleId, quote.bundleNearMiss?.bundleId].filter((x): x is string => Boolean(x));
  const bundles = ids.length ? await prisma.bundle.findMany({ where: { id: { in: ids } }, include }) : [];
  const byId = new Map(bundles.map((b) => [b.id, b]));
  const toMatch = (c: typeof quote.bundleNearMiss) => {
    const bundle = c ? byId.get(c.bundleId) : undefined;
    if (!c || !bundle) return null;
    return {
      bundle,
      matchedCategoryIds: c.matchedCategoryIds,
      missingCategories: bundle.suggestions.filter((s) => c.missingCategoryIds.includes(s.categoryId)).map((s) => s.category),
      eligible: c.eligible,
      discount: toMajor(c.discount),
    };
  };
  return { eligible: toMatch(quote.bundle), nearMiss: toMatch(quote.bundleNearMiss) };
}
