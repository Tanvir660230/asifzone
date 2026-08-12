import type {
  Banner,
  BundleForProduct,
  Category,
  FlashSale,
  HomepageSection,
  PaymentMethodOption,
  Product,
  SearchSuggestions,
  SocialLink,
  StorefrontProductQuery,
  StorefrontProductResult,
  StoreSettings,
  UrgencySignals,
} from "@clothing-brand/shared";
import { env } from "../env";

const REVALIDATE_SECONDS = 60;

async function storefrontFetch<T>(path: string, revalidate = REVALIDATE_SECONDS): Promise<T> {
  const res = await fetch(`${env.apiUrl}${path}`, { next: { revalidate } });
  if (!res.ok) throw new Error(`Storefront fetch failed (${res.status}): ${path}`);
  return res.json();
}

/** Used by layouts that wrap every route and can never be force-dynamic themselves — falls back to
 * `fallback` on any fetch failure (including the Docker image build, when the api container isn't
 * reachable yet) instead of failing the whole page render. */
async function safe<T>(fetcher: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fetcher();
  } catch {
    return fallback;
  }
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export function getCategoryTree() {
  return storefrontFetch<{ tree: CategoryTreeNode[] }>("/api/categories/tree");
}

export function getCategoryTreeSafe() {
  return safe(getCategoryTree, { tree: [] });
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

  return storefrontFetch<StorefrontProductResult>(`/api/products/storefront?${query.toString()}`);
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

export function getActiveHomepageSections() {
  return storefrontFetch<{ sections: HomepageSection[] }>("/api/homepage-sections/active", 60);
}

export function getActiveHomepageSectionsSafe() {
  return safe(getActiveHomepageSections, { sections: [] });
}

export function getSiteSettings() {
  return storefrontFetch<{ settings: StoreSettings }>("/api/settings", 300);
}

const DEFAULT_STORE_SETTINGS: StoreSettings = {
  id: "singleton",
  storeName: "Store",
  tagline: null,
  logoUrl: null,
  logoOnDarkUrl: null,
  faviconUrl: null,
  currency: "BDT",
  contactEmail: null,
  contactPhone: null,
  shippingFeeDhaka: "60",
  shippingFeeOutsideDhaka: "120",
  taxEnabled: false,
  defaultTaxRate: null,
  rewardPointsPerCurrency: "0",
  whatsappMessage: null,
  whatsappLabel: "WhatsApp",
  callEnabled: false,
  callLabel: "Call Us",
  liveChatEnabled: false,
  liveChatLabel: "Live Chat",
  tawkPropertyId: null,
  tawkWidgetId: null,
  paymentMethodsImageUrl: null,
  codEnabled: true,
  onlinePaymentEnabled: true,
  googleSiteVerification: null,
  updatedAt: new Date(0).toISOString(),
};

export function getSiteSettingsSafe() {
  return safe(getSiteSettings, { settings: DEFAULT_STORE_SETTINGS });
}

export function getActiveSocialLinks() {
  return storefrontFetch<{ links: SocialLink[] }>("/api/social-links/active", 300);
}

export function getActiveSocialLinksSafe() {
  return safe(getActiveSocialLinks, { links: [] });
}

export function getActivePaymentMethods() {
  return storefrontFetch<{ methods: PaymentMethodOption[] }>("/api/payment-methods/active", 300);
}

export function getActivePaymentMethodsSafe() {
  return safe(getActivePaymentMethods, { methods: [] });
}

export function getSimilarProducts(productId: string) {
  return storefrontFetch<{ items: Product[] }>(`/api/products/${encodeURIComponent(productId)}/similar`);
}

export function getFrequentlyBoughtTogether(productId: string) {
  return storefrontFetch<{ items: Product[] }>(
    `/api/products/${encodeURIComponent(productId)}/frequently-bought-together`,
  );
}

export function getCompleteYourLook(productId: string) {
  return storefrontFetch<{ items: Product[] }>(`/api/products/${encodeURIComponent(productId)}/complete-your-look`);
}

export function getBudgetAlternatives(productId: string) {
  return storefrontFetch<{ items: Product[] }>(`/api/products/${encodeURIComponent(productId)}/budget-alternatives`);
}

export function getUpgradeOptions(productId: string) {
  return storefrontFetch<{ items: Product[] }>(`/api/products/${encodeURIComponent(productId)}/upgrade-options`);
}

export function getPremiumAlternatives(productId: string) {
  return storefrontFetch<{ items: Product[] }>(`/api/products/${encodeURIComponent(productId)}/premium-alternatives`);
}

/** The active cross-sell bundle (if any) anchored on this product's category, plus the live
 * suggested products — powers the PDP's "Complete the Bundle" section. */
export function getBundleForProduct(productId: string) {
  return storefrontFetch<{ result: BundleForProduct | null }>(
    `/api/bundles/for-product/${encodeURIComponent(productId)}`,
  );
}

/** Server-side, unfiltered "Trending Now" — distinct from the client-only `fetchTrendingProducts`
 * (used on the homepage with a visitor-specific price budget from localStorage). */
export function getTrendingProducts() {
  return storefrontFetch<{ items: Product[] }>("/api/products/storefront/trending");
}

/** Real, aggregate urgency signals (views/purchases/velocity) for a single product's PDP. */
export function getUrgencySignals(productId: string) {
  return storefrontFetch<UrgencySignals>(`/api/products/${encodeURIComponent(productId)}/urgency-signals`);
}

/** Client-side, fire-and-forget page-view beacon — not `storefrontFetch` since it's a POST
 * with no response body to cache. */
export function logProductView(productId: string): void {
  fetch(`${env.apiUrl}/api/products/${encodeURIComponent(productId)}/view`, { method: "POST" }).catch(() => {
    // best-effort only — a failed view log must never affect the visitor's experience
  });
}

/** Client-side fetch — hydrates a locally-stored id list (e.g. "recently viewed") into full
 * product records. Public GET, no credentials needed. */
export async function fetchProductsByIds(ids: string[]) {
  if (ids.length === 0) return { items: [] as Product[] };
  const res = await fetch(`${env.apiUrl}/api/products/storefront/by-ids?ids=${ids.map(encodeURIComponent).join(",")}`);
  if (!res.ok) throw new Error(`Products-by-ids fetch failed (${res.status})`);
  return res.json() as Promise<{ items: Product[] }>;
}

/** Client-side fetch (not `storefrontFetch`/ISR) — params come from the visitor's localStorage
 * signal, which the server has no access to. Public GET, no credentials needed. */
export async function fetchTrendingProducts(params: { minPrice?: number; maxPrice?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.minPrice !== undefined) query.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== undefined) query.set("maxPrice", String(params.maxPrice));
  if (params.limit !== undefined) query.set("limit", String(params.limit));

  const res = await fetch(`${env.apiUrl}/api/products/storefront/trending?${query.toString()}`);
  if (!res.ok) throw new Error(`Trending fetch failed (${res.status})`);
  return res.json() as Promise<{ items: Product[] }>;
}

/** Client-side fetch — see fetchTrendingProducts. */
export async function fetchRecommendedProducts(params: { categoryIds: string[]; exclude?: string; limit?: number }) {
  const query = new URLSearchParams();
  query.set("categoryIds", params.categoryIds.join(","));
  if (params.exclude) query.set("exclude", params.exclude);
  if (params.limit !== undefined) query.set("limit", String(params.limit));

  const res = await fetch(`${env.apiUrl}/api/products/storefront/recommended?${query.toString()}`);
  if (!res.ok) throw new Error(`Recommended fetch failed (${res.status})`);
  return res.json() as Promise<{ items: Product[] }>;
}

/** Client-side fetch — debounced typeahead call, driven by whatever the visitor is currently
 * typing. Public GET, no credentials needed. */
export async function fetchSearchSuggestions(query: string, limit = 6) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${env.apiUrl}/api/products/storefront/suggest?${params.toString()}`);
  if (!res.ok) throw new Error(`Search-suggest fetch failed (${res.status})`);
  return res.json() as Promise<SearchSuggestions>;
}

/** Client-side fetch — shown when the search overlay opens with an empty query. */
export async function fetchPopularSearches(limit = 8) {
  const res = await fetch(`${env.apiUrl}/api/products/storefront/popular-searches?limit=${limit}`);
  if (!res.ok) throw new Error(`Popular-searches fetch failed (${res.status})`);
  return res.json() as Promise<{ queries: string[] }>;
}
