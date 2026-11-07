import type { Product } from "@clothing-brand/shared";

/**
 * A product as a listing card needs it. Listings (home sections, category, search) send their products to client-side
 * cards, and everything on the object travels to the phone inside the page. The long texts (description, SEO), the
 * category's own banner/SEO record and each variant's bookkeeping dates were ~35% of every card and are never shown
 * on one (measured on Asif Zone's home page, 2026-11-08: 4.2 KB a product). The product page loads the full product
 * itself, so nothing is lost there. Same shape, so every card and helper keeps working.
 */
export function cardProduct(p: Product): Product {
  return {
    ...p,
    description: "",
    shortDescription: null,
    seoTitle: null,
    seoDescription: null,
    ogTitle: null,
    ogDescription: null,
    ogImageUrl: null,
    canonicalUrl: null,
    category: p.category
      ? {
          id: p.category.id,
          name: p.category.name,
          slug: p.category.slug,
          parentId: p.category.parentId,
          imageUrl: null,
          imageAltText: null,
          wideImageUrl: null,
          bannerImageUrl: null,
          sortOrder: p.category.sortOrder,
          isActive: p.category.isActive,
          isFeatured: p.category.isFeatured,
          seoTitle: null,
          seoDescription: null,
          deletedAt: null,
          createdAt: "",
          updatedAt: "",
        }
      : p.category,
    variants: p.variants?.map((v) => ({ ...v, createdAt: "", updatedAt: "", barcode: null })),
  };
}

export function cardProducts<T extends { items: Product[] }>(result: T): T {
  return { ...result, items: result.items.map(cardProduct) };
}
