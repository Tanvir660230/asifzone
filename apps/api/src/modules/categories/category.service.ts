import { Prisma, type Category } from "@prisma/client";
import type {
  CreateCategoryInput,
  UpdateCategoryInput,
  ReorderCategoriesInput,
  MoveCategoryInput,
  CategoryStockStat,
} from "@clothing-brand/shared";
import { slugify } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { ensureUniqueSlug } from "../../lib/unique-slug";
import { deleteSiteImageFile } from "../uploads/upload.service";

const CACHE_PREFIX = "categories:";
const CACHE_TTL_SECONDS = 300;

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_PREFIX);
}

export async function listCategories(query: { trashed?: boolean } = {}) {
  return prisma.category.findMany({
    where: { deletedAt: query.trashed ? { not: null } : null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { children: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
  });
}

/** Powers the storefront nav (mega menu / mobile nav / footer), so only active categories are
 * included — an inactive category is filtered out of `all` before the tree is built, which also
 * drops any of its children regardless of their own isActive (a hidden branch stays fully hidden;
 * there's no such thing as an active category nested under a hidden one). */
export async function getCategoryTree() {
  const cacheKey = `${CACHE_PREFIX}tree`;
  const cached = await cacheGet<unknown[]>(cacheKey);
  if (cached) return cached;

  const all = await prisma.category.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const byParent = new Map<string | null, typeof all>();
  for (const cat of all) {
    const key = cat.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(cat);
  }
  function build(parentId: string | null): unknown[] {
    return (byParent.get(parentId) ?? []).map((cat) => ({ ...cat, children: build(cat.id) }));
  }
  const tree = build(null);
  await cacheSet(cacheKey, tree, CACHE_TTL_SECONDS);
  return tree;
}

export async function getCategoryById(id: string) {
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) throw AppError.notFound("Category not found");
  return category;
}

/** Public lookup: only returns active categories, matching what the storefront should link to. */
export async function getCategoryBySlug(slug: string) {
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category || !category.isActive || category.deletedAt) throw AppError.notFound("Category not found");
  return category;
}

/** Walks the parent chain root-first, for breadcrumb rendering. */
export async function getCategoryBreadcrumb(category: { id: string; parentId: string | null }) {
  const chain: Category[] = [];
  let parentId = category.parentId;
  while (parentId) {
    const parent: Category | null = await prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parentId;
  }
  return chain;
}

/** id/parentId for every category, Redis-cached — this is a hot storefront-path lookup (every
 * category-scoped browse/facet request calls getCategoryDescendantIds), so unlike a one-off admin
 * query it's worth caching the same way getCategoryTree already is. Invalidated by the same
 * invalidateCache() every category mutation already calls. Cached as a flat list rather than the
 * Map getCategoryDescendantIds/getSiblingCategoryIds build from it, since cacheSet/cacheGet
 * round-trip through JSON and a Map doesn't survive that. */
async function getCategoryParentPairs(): Promise<Array<{ id: string; parentId: string | null }>> {
  const cacheKey = `${CACHE_PREFIX}parent-pairs`;
  const cached = await cacheGet<Array<{ id: string; parentId: string | null }>>(cacheKey);
  if (cached) return cached;

  const all = await prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true } });
  await cacheSet(cacheKey, all, CACHE_TTL_SECONDS);
  return all;
}

/** Category id plus every descendant id (self included) — used to show a parent category's products from all its subcategories. */
export async function getCategoryDescendantIds(categoryId: string): Promise<string[]> {
  const all = await getCategoryParentPairs();
  const byParent = new Map<string | null, string[]>();
  for (const cat of all) {
    const key = cat.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(cat.id);
  }

  const ids = [categoryId];
  const stack = [categoryId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const childId of byParent.get(id) ?? []) {
      ids.push(childId);
      stack.push(childId);
    }
  }
  return ids;
}

/** Live (isActive, non-deleted) product/unit counts for one category scope — self plus every
 * descendant, same rollup listStorefrontProducts uses so these numbers match what a shopper
 * actually sees when browsing that category. */
async function getCategoryStockStat(categoryId: string) {
  const descendantIds = await getCategoryDescendantIds(categoryId);
  const where = { categoryId: { in: descendantIds }, isActive: true, deletedAt: null };

  const [totalProducts, inStockProducts, stockSum] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.count({ where: { ...where, variants: { some: { stock: { gt: 0 } } } } }),
    prisma.productVariant.aggregate({ where: { product: where }, _sum: { stock: true } }),
  ]);

  return { totalProducts, inStockProducts, totalStock: stockSum._sum.stock ?? 0 };
}

/** Powers the category page's "N in stock" summary and its subcategory breakdown — the parent's
 * own stat rolls up every descendant (matching what browsing the parent category shows), while
 * each subcategory's stat rolls up only its own descendants. Not cached like getCategoryTree:
 * stock changes with every order, and this is a single per-page-view read rather than a
 * hit-every-request nav lookup, so staleness would cost more than it saves here. */
export async function getCategoryStockOverview(categoryId: string) {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId, isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true },
  });

  const [total, subStats] = await Promise.all([
    getCategoryStockStat(categoryId),
    Promise.all(children.map((child) => getCategoryStockStat(child.id))),
  ]);

  return {
    total,
    subcategories: children.map((child, i) => ({ ...child, ...subStats[i]! })),
  };
}

/** Own-category + rolled-up-to-every-ancestor stock stats for every category in one pass — powers
 * the admin category tree's per-row stock badge. Unlike getCategoryStockStat (storefront, one
 * category at a time via a cached descendant lookup), this computes every node's total in a single
 * pass: one query for each product's variant stock, then a bottom-up accumulate over the parent
 * chain so a parent's total already folds in every descendant's, matching the "self + descendants"
 * semantics getCategoryStockOverview uses on the storefront. */
export async function getCategoryStockMap(): Promise<Record<string, CategoryStockStat>> {
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true } }),
    prisma.product.findMany({
      where: { isActive: true, deletedAt: null },
      select: { categoryId: true, variants: { select: { stock: true } } },
    }),
  ]);

  const own = new Map<string, CategoryStockStat>();
  for (const cat of categories) own.set(cat.id, { totalProducts: 0, inStockProducts: 0, totalStock: 0 });
  for (const product of products) {
    const stat = own.get(product.categoryId);
    if (!stat) continue;
    stat.totalProducts += 1;
    const stock = product.variants.reduce((sum, v) => sum + v.stock, 0);
    stat.totalStock += stock;
    if (product.variants.some((v) => v.stock > 0)) stat.inStockProducts += 1;
  }

  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const rollup: Record<string, CategoryStockStat> = {};
  for (const cat of categories) rollup[cat.id] = { totalProducts: 0, inStockProducts: 0, totalStock: 0 };
  for (const cat of categories) {
    const stat = own.get(cat.id)!;
    let current: string | null = cat.id;
    while (current) {
      const target = rollup[current]!;
      target.totalProducts += stat.totalProducts;
      target.inStockProducts += stat.inStockProducts;
      target.totalStock += stat.totalStock;
      current = parentOf.get(current) ?? null;
    }
  }

  return rollup;
}

/** Other categories under the same parent (or other top-level categories, if this one has no parent) —
 * used to pair complementary product types for "Complete Your Look" (e.g. Shirts ↔ Trousers). */
export async function getSiblingCategoryIds(categoryId: string): Promise<string[]> {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { parentId: true } });
  if (!category) return [];

  const siblings = await prisma.category.findMany({
    where: { parentId: category.parentId, id: { not: categoryId } },
    select: { id: true },
  });
  return siblings.map((s) => s.id);
}

/** Rejects a reparent that would make `id` an ancestor of itself — walks newParentId's own parent
 * chain looking for `id`. Neither updateCategory's plain parentId edit nor moveCategory guarded
 * against this before (only "not its own direct parent" was checked), so a category could be
 * reparented under one of its own descendants and silently create a loop. */
async function assertNoCycle(id: string, newParentId: string | null) {
  let current = newParentId;
  while (current) {
    if (current === id) throw AppError.badRequest("Cannot move a category under one of its own subcategories");
    const parent: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    current = parent?.parentId ?? null;
  }
}

export async function createCategory(input: CreateCategoryInput) {
  if (input.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: input.parentId } });
    if (!parent || parent.deletedAt) throw AppError.badRequest("Parent category does not exist");
  }

  const baseSlug = slugify(input.slug || input.name);
  const slug = await ensureUniqueSlug(baseSlug, async (candidate) => {
    const existing = await prisma.category.findUnique({ where: { slug: candidate } });
    return Boolean(existing);
  });

  let category;
  try {
    category = await prisma.category.create({ data: { ...input, slug } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A category with this slug already exists");
    }
    throw err;
  }
  await invalidateCache();
  return category;
}

export async function updateCategory(id: string, input: UpdateCategoryInput) {
  await getCategoryById(id);

  if (input.parentId === id) {
    throw AppError.badRequest("A category cannot be its own parent");
  }
  if (input.parentId !== undefined) {
    await assertNoCycle(id, input.parentId);
    if (input.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.deletedAt) throw AppError.badRequest("Parent category does not exist");
    }
  }

  const data: Record<string, unknown> = { ...input };
  if (input.name && !input.slug) {
    data.slug = await ensureUniqueSlug(slugify(input.name), async (candidate) => {
      const existing = await prisma.category.findFirst({ where: { slug: candidate, NOT: { id } } });
      return Boolean(existing);
    });
  }

  let category;
  try {
    category = await prisma.category.update({ where: { id }, data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw AppError.conflict("A category with this slug already exists");
    }
    throw err;
  }
  await invalidateCache();
  return category;
}

/** Persists a drag-and-drop reorder within a single sibling group. All items must already share
 * the same parentId — this is a pure reorder, not a way to reparent a category (that stays a
 * deliberate action via the edit form, which already guards against creating a cycle). */
export async function reorderCategories(input: ReorderCategoriesInput) {
  const ids = input.items.map((item) => item.id);
  const existing = await prisma.category.findMany({
    where: { id: { in: ids } },
    select: { id: true, parentId: true },
  });
  if (existing.length !== ids.length) throw AppError.badRequest("One or more categories were not found");

  const parentIds = new Set(existing.map((c) => c.parentId));
  if (parentIds.size > 1) throw AppError.badRequest("All reordered categories must share the same parent");

  await prisma.$transaction(
    input.items.map((item) => prisma.category.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
  );
  await invalidateCache();
}

/** Drag-and-drop reparent: moves a category into a different parent's sibling group and places it
 * at `sortOrder`, shifting the destination siblings that come after it. Unlike reorderCategories
 * (same-parent only), this is the one path that actually changes `parentId` via drag. */
export async function moveCategory(id: string, input: MoveCategoryInput) {
  const category = await getCategoryById(id);
  if (input.newParentId === id) throw AppError.badRequest("A category cannot be its own parent");
  await assertNoCycle(id, input.newParentId);

  if (input.newParentId) {
    const parent = await prisma.category.findUnique({ where: { id: input.newParentId } });
    if (!parent || parent.deletedAt) throw AppError.badRequest("Parent category does not exist");
  }

  const destinationSiblings = await prisma.category.findMany({
    where: { parentId: input.newParentId, id: { not: id } },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  const siblingIds = destinationSiblings.map((s) => s.id);
  siblingIds.splice(Math.min(input.sortOrder, siblingIds.length), 0, id);

  await prisma.$transaction([
    prisma.category.update({ where: { id }, data: { parentId: input.newParentId } }),
    ...siblingIds.map((siblingId, index) =>
      prisma.category.update({ where: { id: siblingId }, data: { sortOrder: index } }),
    ),
  ]);
  await invalidateCache();
  return getCategoryById(category.id);
}

/** Soft delete — moves the category to Trash instead of destroying it. Still requires the category
 * be empty first (no live products/subcategories) so it never disappears from admin pickers while
 * something live still points at it — only categories whose products/children are themselves
 * already trashed count as "empty" here. Use `permanentlyDeleteCategory` to purge from Trash. */
export async function deleteCategory(id: string) {
  await getCategoryById(id);

  const [productCount, childCount] = await Promise.all([
    prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
    prisma.category.count({ where: { parentId: id, deletedAt: null } }),
  ]);

  if (productCount > 0) throw AppError.conflict("Cannot delete a category that still has products");
  if (childCount > 0) throw AppError.conflict("Cannot delete a category that still has subcategories");

  await prisma.category.update({ where: { id }, data: { deletedAt: new Date() } });
  await invalidateCache();
}

export async function restoreCategory(id: string) {
  await getCategoryById(id);
  await prisma.category.update({ where: { id }, data: { deletedAt: null } });
  await invalidateCache();
  return getCategoryById(id);
}

/** Irreversible — only meaningful for a category already in Trash. Blocks on the same
 * products/subcategories guard as the soft delete (defense in depth), plus one Category-specific
 * check Product's trash pattern doesn't need: Bundle.anchorCategory cascades on a real category
 * delete, so purging a category that still anchors a Bundle would silently take the Bundle with it. */
export async function permanentlyDeleteCategory(id: string) {
  const category = await getCategoryById(id);
  if (!category.deletedAt) throw AppError.badRequest("Move the category to Trash before deleting it permanently");

  const [productCount, childCount, bundleCount] = await Promise.all([
    prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
    prisma.category.count({ where: { parentId: id, deletedAt: null } }),
    prisma.bundle.count({ where: { anchorCategoryId: id } }),
  ]);
  if (productCount > 0) throw AppError.conflict("Cannot delete a category that still has products");
  if (childCount > 0) throw AppError.conflict("Cannot delete a category that still has subcategories");
  if (bundleCount > 0) throw AppError.conflict("Cannot permanently delete a category that anchors a Bundle — delete or reassign the Bundle first");

  await prisma.category.delete({ where: { id } });
  if (category.imageUrl) await deleteSiteImageFile(category.imageUrl);
  if (category.bannerImageUrl) await deleteSiteImageFile(category.bannerImageUrl);
  await invalidateCache();
}
