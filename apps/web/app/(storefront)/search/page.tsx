import type { Metadata } from "next";
import type { ProductSort } from "@clothing-brand/shared";
import { SearchBox } from "@/components/storefront/search-box";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { ProductGrid } from "@/components/storefront/product-grid";
import { SortSelect } from "@/components/storefront/sort-select";
import { Pagination } from "@/components/storefront/pagination";
import { FacetFilters } from "@/components/storefront/facet-filters";
import { NoSearchResults } from "@/components/storefront/no-search-results";
import { SearchSessionTracker } from "@/components/analytics/search-session-tracker";
import { fetchPopularSearches, getSiteSettings, getStorefrontFacets, listStorefrontProducts } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { buildItemListJsonLd } from "@/lib/structured-data";
import { jsonLdString } from "@clothing-brand/shared";

const PAGE_SIZE = 24;

interface Props {
  // Next.js 15: searchParams is a Promise on server components (was a plain object pre-15) —
  // must be awaited before use.
  searchParams: Promise<{
    q?: string;
    sort?: string;
    page?: string;
    sizes?: string;
    colors?: string;
    minPrice?: string;
    maxPrice?: string;
  }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [resolvedSearchParams, { settings }] = await Promise.all([searchParams, getSiteSettings()]);
  const query = resolvedSearchParams.q?.trim();
  const title = query ? `Search results for "${query}"` : "All Products";
  const page = Number(resolvedSearchParams.page) || 1;
  const url = `${getSiteUrl()}/search${page > 1 ? `?page=${page}` : ""}`;
  return {
    title,
    alternates: { canonical: url },
    ...buildOpenGraph({ title, url, siteName: settings.storeName }),
    // The bare /search landing page (in the sitemap) stays indexable; every query-result variant
    // is near-duplicate content, so keep those out of the index rather than indexing every permutation.
    ...(query ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const resolvedSearchParams = await searchParams;
  const query = resolvedSearchParams.q?.trim();
  // Relevance only makes sense once there's a query to be relevant *to* — a bare browse-all-products
  // visit (no `q`) keeps defaulting to newest-first, same as before.
  const sort = (resolvedSearchParams.sort as ProductSort) || (query ? "relevance" : "newest");
  const page = Number(resolvedSearchParams.page) || 1;
  const sizes = resolvedSearchParams.sizes?.split(",").filter(Boolean);
  const colors = resolvedSearchParams.colors?.split(",").filter(Boolean);
  const minPrice = resolvedSearchParams.minPrice ? Number(resolvedSearchParams.minPrice) : undefined;
  const maxPrice = resolvedSearchParams.maxPrice ? Number(resolvedSearchParams.maxPrice) : undefined;

  // No `q` isn't an empty/unusable state — it's "browse everything," same query shape as a
  // category page minus the category filter. Only the search term is optional here.
  const [result, facets] = await Promise.all([
    listStorefrontProducts({ search: query, sort, page, pageSize: PAGE_SIZE, sizes, colors, minPrice, maxPrice }),
    getStorefrontFacets({ search: query }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  // Nothing is named, categorised or tagged by the query: the results only mention it, and the page says so.
  const related = Boolean(query) && result.matchQuality === "related" && result.items.length > 0;
  // A dead end gets a few searches that do work; fetched only then, and never allowed to break the page.
  const popular = query && result.items.length === 0 ? (await fetchPopularSearches().catch(() => ({ queries: [] }))).queries : [];

  const plural = result.total === 1 ? "" : "s";
  const countLine = !query ? `${result.total} product${plural}` : related ? `${result.total} related product${plural}` : `${result.total} result${plural}`;

  return (
    <StorefrontPage>
      <SearchSessionTracker query={query} />
      <StorefrontPageHeader
        eyebrow={query ? "Search" : "Shop"}
        title={query ? <>Results for &ldquo;{query}&rdquo;</> : "All products"}
        description={countLine}
        actions={
          <div className="hidden lg:block">
            <SortSelect hasQuery={Boolean(query)} />
          </div>
        }
      />
      {/* Refine the search where the results start, at the page's left edge like every other control. */}
      <div className="mb-8 max-w-2xl">
        <SearchBox initialValue={query} />
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-10">
        <h2 className="sr-only">Refine</h2>
        <FacetFilters facets={facets} toolbarExtra={<SortSelect hasQuery={Boolean(query)} className="w-44" />} />
        <div className="min-w-0 flex-1">
          <h2 className="sr-only">Products</h2>
          {result.items.length > 0 && (
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(buildItemListJsonLd(result.items, getSiteUrl())) }} />
          )}
          {related && <p className="mb-6 text-[15px] text-fg-muted">No exact matches for &ldquo;{query}&rdquo;. These products are related to it.</p>}
          <ProductGrid
            products={result.items}
            emptyState={query ? <NoSearchResults query={query} didYouMean={result.didYouMean} popular={popular} /> : undefined}
          />
          <Pagination page={page} totalPages={totalPages} />
        </div>
      </div>
    </StorefrontPage>
  );
}
