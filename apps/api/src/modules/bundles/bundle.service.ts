import type { CreateBundleInput, UpdateBundleInput, BundleListQuery } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { paginate } from "../../lib/paginate";
import { getRecommendedByCategories } from "../products/product.service";

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
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true } });
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

/** Resolves cart items to their product categories, then checks every active bundle whose anchor
 * category is present against which suggestion categories are also in the cart. Returns one entry
 * per candidate bundle regardless of eligibility, so callers can both pick the best discount and
 * nudge a shopper who's close but not quite there. The discount is computed off only the matched
 * line items (anchor + matched-suggestion lines), never the whole cart, so an unrelated large cart
 * isn't discounted just because it happens to contain a Panjabi. */
async function getCandidateBundleMatches(items: { variantId: string; quantity: number }[]) {
  const variantIds = items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, price: true, product: { select: { categoryId: true, basePrice: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const categoryIdsInCart = new Set<string>();
  const lineTotalByCategory = new Map<string, number>();
  for (const item of items) {
    const variant = variantById.get(item.variantId);
    if (!variant) continue;
    const categoryId = variant.product.categoryId;
    const price = variant.price !== null ? Number(variant.price) : Number(variant.product.basePrice);
    categoryIdsInCart.add(categoryId);
    lineTotalByCategory.set(categoryId, (lineTotalByCategory.get(categoryId) ?? 0) + price * item.quantity);
  }
  if (categoryIdsInCart.size === 0) return [];

  const candidateBundles = await prisma.bundle.findMany({
    where: { isActive: true, anchorCategoryId: { in: [...categoryIdsInCart] } },
    include,
  });

  return candidateBundles.map((bundle) => {
    const matchedSuggestions = bundle.suggestions.filter((s) => categoryIdsInCart.has(s.categoryId));
    const missingSuggestions = bundle.suggestions.filter((s) => !categoryIdsInCart.has(s.categoryId));
    const matchedCategoryIds = [bundle.anchorCategoryId, ...matchedSuggestions.map((s) => s.categoryId)];
    const matchedSubtotal = matchedCategoryIds.reduce((sum, id) => sum + (lineTotalByCategory.get(id) ?? 0), 0);

    let discount =
      bundle.discountType === "PERCENTAGE"
        ? Math.round((matchedSubtotal * Number(bundle.discountValue)) / 100)
        : Number(bundle.discountValue);
    discount = Math.min(discount, matchedSubtotal);

    return {
      bundle,
      matchedCategoryIds,
      missingCategories: missingSuggestions.map((s) => s.category),
      eligible: matchedSuggestions.length >= bundle.minSuggestedCategories,
      discount,
    };
  });
}

/** The best *eligible* bundle discount for this cart, if any — used both by the storefront preview
 * and, authoritatively, by order creation. */
export async function evaluateBundleForItems(items: { variantId: string; quantity: number }[]) {
  const matches = (await getCandidateBundleMatches(items)).filter((m) => m.eligible);
  if (matches.length === 0) return null;
  return matches.reduce((best, m) => (m.discount > best.discount ? m : best));
}

/** Storefront-facing preview: the best eligible discount (identical to `evaluateBundleForItems`,
 * used to show what checkout will apply) plus the closest near-miss bundle — anchor already in
 * cart, not yet enough suggested categories — so the cart page can nudge exactly what's missing. */
export async function getBundleCartPreview(items: { variantId: string; quantity: number }[]) {
  const matches = await getCandidateBundleMatches(items);

  const eligible = matches.filter((m) => m.eligible);
  const best = eligible.length > 0 ? eligible.reduce((a, b) => (b.discount > a.discount ? b : a)) : null;

  const nearMisses = matches.filter((m) => !m.eligible);
  const nearMiss =
    nearMisses.length > 0
      ? nearMisses.reduce((a, b) => (b.missingCategories.length < a.missingCategories.length ? b : a))
      : null;

  return { eligible: best, nearMiss };
}
