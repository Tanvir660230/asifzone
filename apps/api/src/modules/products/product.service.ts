import type {
  CreateProductInput,
  UpdateProductInput,
  ProductListQuery,
  StorefrontProductQuery,
  StorefrontFacetsQuery,
} from "@clothing-brand/shared";
import { slugify } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheDelByPrefix, cacheGet, cacheSet } from "../../config/redis";
import { AppError } from "../../lib/app-error";
import { ensureUniqueSlug } from "../../lib/unique-slug";
import { deleteProductImageFiles } from "../uploads/upload.service";
import { getCategoryBySlug, getCategoryDescendantIds } from "../categories/category.service";
import { computeFlashPrice, getActiveFlashInfoByProduct } from "../flash-sales/flash-sale-pricing";

const CACHE_PREFIX = "products:";
const CACHE_TTL_SECONDS = 120;
const include = { variants: true, images: { orderBy: { sortOrder: "asc" as const } }, category: true };

/** Attaches `activeFlashSale` (flash-discounted price, if any is currently running) to each product — storefront-facing reads only. */
async function withFlashSaleInfo<T extends { id: string; basePrice: unknown }>(products: T[]) {
  const flashByProduct = await getActiveFlashInfoByProduct(products.map((p) => p.id));
  return products.map((product) => {
    const flash = flashByProduct.get(product.id);
    if (!flash) return { ...product, activeFlashSale: null };
    return {
      ...product,
      activeFlashSale: {
        flashSaleId: flash.flashSaleId,
        flashSaleName: flash.flashSaleName,
        endsAt: flash.endsAt,
        discountType: flash.discountType,
        discountValue: flash.discountValue,
        flashPrice: computeFlashPrice(Number(product.basePrice), flash),
      },
    };
  });
}

async function invalidateCache() {
  await cacheDelByPrefix(CACHE_PREFIX);
}

const SORT_ORDER_BY: Record<string, object> = {
  newest: { createdAt: "desc" },
  price_asc: { basePrice: "asc" },
  price_desc: { basePrice: "desc" },
};

export async function listProducts(query: ProductListQuery) {
  const where = {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.search
      ? { name: { contains: query.search, mode: "insensitive" as const } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getProductById(id: string) {
  const product = await prisma.product.findUnique({ where: { id }, include });
  if (!product) throw AppError.notFound("Product not found");
  return product;
}

/** Public lookup: only returns active products, matching what the storefront should link to. */
export async function getProductBySlug(slug: string) {
  const cacheKey = `${CACHE_PREFIX}slug:${slug}`;
  let product = await cacheGet<Awaited<ReturnType<typeof getProductById>>>(cacheKey);

  if (!product) {
    product = await prisma.product.findUnique({ where: { slug }, include });
    if (!product || !product.isActive) throw AppError.notFound("Product not found");
    await cacheSet(cacheKey, product, CACHE_TTL_SECONDS);
  }

  const [withFlash] = await withFlashSaleInfo([product]);
  return withFlash;
}

/** Storefront browsing: active products only, optionally scoped to a category (and its subcategories), searched, sorted. */
export async function listStorefrontProducts(query: StorefrontProductQuery) {
  let categoryIds: string[] | undefined;
  if (query.category) {
    const category = await getCategoryBySlug(query.category);
    categoryIds = await getCategoryDescendantIds(category.id);
  }

  const where = {
    isActive: true,
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(query.featured ? { isFeatured: true } : {}),
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.sizes?.length ? { variants: { some: { size: { in: query.sizes } } } } : {}),
    ...(query.colors?.length ? { variants: { some: { color: { in: query.colors } } } } : {}),
    ...(query.minPrice !== undefined || query.maxPrice !== undefined
      ? {
          basePrice: {
            ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
            ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
          },
        }
      : {}),
  };

  const [rawItems, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include,
      orderBy: SORT_ORDER_BY[query.sort],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  const items = await withFlashSaleInfo(rawItems);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** Available filter options (sizes/colors/price range) for the storefront's currently-scoped product set — recomputed per category/search so the panel never offers a facet with zero results. */
export async function getStorefrontFacets(query: StorefrontFacetsQuery) {
  let categoryIds: string[] | undefined;
  if (query.category) {
    const category = await getCategoryBySlug(query.category);
    categoryIds = await getCategoryDescendantIds(category.id);
  }

  const where = {
    isActive: true,
    ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [sizes, colors, priceRange] = await Promise.all([
    prisma.productVariant.findMany({
      where: { product: where },
      distinct: ["size"],
      select: { size: true },
    }),
    prisma.productVariant.findMany({
      where: { product: where },
      distinct: ["color"],
      select: { color: true, colorHex: true },
    }),
    prisma.product.aggregate({ where, _min: { basePrice: true }, _max: { basePrice: true } }),
  ]);

  return {
    sizes: sizes.map((s) => s.size).sort(),
    colors: colors.map((c) => ({ color: c.color, colorHex: c.colorHex })).sort((a, b) => a.color.localeCompare(b.color)),
    minPrice: priceRange._min.basePrice ? Number(priceRange._min.basePrice) : 0,
    maxPrice: priceRange._max.basePrice ? Number(priceRange._max.basePrice) : 0,
  };
}

export async function createProduct(input: CreateProductInput) {
  const category = await prisma.category.findUnique({ where: { id: input.categoryId } });
  if (!category) throw AppError.badRequest("Category does not exist");

  const skus = input.variants.map((v) => v.sku);
  if (new Set(skus).size !== skus.length) throw AppError.badRequest("Duplicate SKU in variants");

  const baseSlug = slugify(input.slug || input.name);
  const slug = await ensureUniqueSlug(baseSlug, async (candidate) => {
    return Boolean(await prisma.product.findUnique({ where: { slug: candidate } }));
  });

  const { variants, ...productData } = input;

  const product = await prisma.product.create({
    data: {
      ...productData,
      slug,
      variants: { create: variants },
    },
    include,
  });

  await invalidateCache();
  return product;
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  const existing = await getProductById(id);

  const data: Record<string, unknown> = { ...input };
  delete data.variants;

  if (input.name && !input.slug) {
    data.slug = await ensureUniqueSlug(slugify(input.name), async (candidate) => {
      return Boolean(await prisma.product.findFirst({ where: { slug: candidate, NOT: { id } } }));
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data });

    if (input.variants) {
      const incomingIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));
      const toDelete = existing.variants.filter((v) => !incomingIds.has(v.id));

      if (toDelete.length) {
        await tx.productVariant.deleteMany({ where: { id: { in: toDelete.map((v) => v.id) } } });
      }

      for (const variant of input.variants) {
        if (variant.id) {
          await tx.productVariant.update({ where: { id: variant.id }, data: variant });
        } else {
          await tx.productVariant.create({ data: { ...variant, productId: id } });
        }
      }
    }
  });

  await invalidateCache();
  return getProductById(id);
}

export async function deleteProduct(id: string) {
  const product = await getProductById(id);
  await prisma.product.delete({ where: { id } });
  await Promise.all(product.images.map((img) => deleteProductImageFiles(img.url)));
  await invalidateCache();
}

export async function addProductImages(productId: string, images: Array<{ url: string; altText?: string }>) {
  await getProductById(productId);
  const existingCount = await prisma.productImage.count({ where: { productId } });

  await prisma.productImage.createMany({
    data: images.map((img, i) => ({ ...img, productId, sortOrder: existingCount + i })),
  });
  await invalidateCache();
  return getProductById(productId);
}

export async function deleteProductImage(productId: string, imageId: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image || image.productId !== productId) throw AppError.notFound("Image not found");
  await prisma.productImage.delete({ where: { id: imageId } });
  await deleteProductImageFiles(image.url);
  await invalidateCache();
}
