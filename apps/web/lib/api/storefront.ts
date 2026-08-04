import type { Banner, Category, FlashSale, PaginatedResult, Product, StorefrontProductQuery } from "@clothing-brand/shared";
import { env } from "../env";

const REVALIDATE_SECONDS = 60;

async function storefrontFetch<T>(path: string, revalidate = REVALIDATE_SECONDS): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Storefront fetch failed (${res.status}): ${path}`);
  return res.json();
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export function getCategoryTree() {
  return storefrontFetch<{ tree: CategoryTreeNode[] }>("/api/categories/tree");
}

export function getCategoryBySlug(slug: string) {
  return storefrontFetch<{ category: Category; breadcrumb: Category[] }>(
    `/api/categories/slug/${encodeURIComponent(slug)}`,
  );
}

export function getProductBySlug(slug: string) {
  return storefrontFetch<{ product: Product }>(`/api/products/slug/${encodeURIComponent(slug)}`);
}

export function listStorefrontProducts(params: Partial<StorefrontProductQuery> = {}) {
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.search) query.set("search", params.search);
  if (params.featured) query.set("featured", "true");
  if (params.sort) query.set("sort", params.sort);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.sizes?.length) query.set("sizes", params.sizes.join(","));
  if (params.colors?.length) query.set("colors", params.colors.join(","));
  if (params.minPrice !== undefined) query.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== undefined) query.set("maxPrice", String(params.maxPrice));

  return storefrontFetch<PaginatedResult<Product>>(`/api/products/storefront?${query.toString()}`);
}

export interface StorefrontFacets {
  sizes: string[];
  colors: { color: string; colorHex: string | null }[];
  minPrice: number;
  maxPrice: number;
}

export function getStorefrontFacets(params: { category?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.search) query.set("search", params.search);
  return storefrontFetch<StorefrontFacets>(`/api/products/storefront/facets?${query.toString()}`, 60);
}

export function getActiveFlashSale() {
  return storefrontFetch<{ flashSale: FlashSale | null }>("/api/flash-sales/active", 30);
}

export function getActiveBanners(placement: "HERO_CAROUSEL" | "PROMO_STRIP" = "HERO_CAROUSEL") {
  return storefrontFetch<{ banners: Banner[] }>(`/api/banners/active?placement=${placement}`, 60);
}
