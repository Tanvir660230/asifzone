import type { Category } from "@prisma/client";
import type { CreateCategoryInput, UpdateCategoryInput, ReorderCategoriesInput } from "@clothing-brand/shared";
import { slugify } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { ensureUniqueSlug } from "../../lib/unique-slug";

const CACHE_PREFIX = "categories:";
const CACHE_TTL_SECONDS = 300;

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_PREFIX);
}

export async function listCategories() {
  return prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { children: { orderBy: { sortOrder: "asc" } } },
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

  const all = await prisma.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
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
  if (!category || !category.isActive) throw AppError.notFound("Category not found");
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

/** Category id plus every descendant id (self included) — used to show a parent category's products from all its subcategories. */
export async function getCategoryDescendantIds(categoryId: string): Promise<string[]> {
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } });
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

export async function createCategory(input: CreateCategoryInput) {
  if (input.parentId) {
    const parent = await prisma.category.findUnique({ where: { id: input.parentId } });
    if (!parent) throw AppError.badRequest("Parent category does not exist");
  }

  const baseSlug = slugify(input.slug || input.name);
  const slug = await ensureUniqueSlug(baseSlug, async (candidate) => {
    const existing = await prisma.category.findUnique({ where: { slug: candidate } });
    return Boolean(existing);
  });

  const category = await prisma.category.create({
    data: { ...input, slug },
  });
  await invalidateCache();
  return category;
}

export async function updateCategory(id: string, input: UpdateCategoryInput) {
  await getCategoryById(id);

  if (input.parentId === id) {
    throw AppError.badRequest("A category cannot be its own parent");
  }

  const data: Record<string, unknown> = { ...input };
  if (input.name && !input.slug) {
    data.slug = await ensureUniqueSlug(slugify(input.name), async (candidate) => {
      const existing = await prisma.category.findFirst({ where: { slug: candidate, NOT: { id } } });
      return Boolean(existing);
    });
  }

  const category = await prisma.category.update({ where: { id }, data });
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

export async function deleteCategory(id: string) {
  await getCategoryById(id);

  const [productCount, childCount] = await Promise.all([
    prisma.product.count({ where: { categoryId: id } }),
    prisma.category.count({ where: { parentId: id } }),
  ]);

  if (productCount > 0) throw AppError.conflict("Cannot delete a category that still has products");
  if (childCount > 0) throw AppError.conflict("Cannot delete a category that still has subcategories");

  await prisma.category.delete({ where: { id } });
  await invalidateCache();
}
