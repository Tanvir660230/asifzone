import type { Metadata } from "next";
import type { ProductSort } from "@clothing-brand/shared";
import { SearchBox } from "@/components/storefront/search-box";
import { ProductGrid } from "@/components/storefront/product-grid";
import { SortSelect } from "@/components/storefront/sort-select";
import { Pagination } from "@/components/storefront/pagination";
import { FacetFilters } from "@/components/storefront/facet-filters";
import { NoSearchResults } from "@/components/storefront/no-search-results";
import { SearchSessionTracker } from "@/components/analytics/search-session-tracker";
import { getStorefrontFacets, listStorefrontProducts } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { buildItemListJsonLd } from "@/lib/structured-data";

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
  const resolvedSearchParams = await searchParams;
  const query = resolvedSearchParams.q?.trim();
  const title = query ? `Search results for "${query}"` : "All Products";
  const page = Number(resolvedSearchParams.page) || 1;
  const url = `${getSiteUrl()}/search${page > 1 ? `?page=${page}` : ""}`;
  return {
    title,
    alternates: { canonical: url },
    ...buildOpenGraph({ title, url }),
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

  return (
    <div>
      <SearchSessionTracker query={query} />
      {/* An editorial header band, same language as the other content pages (PageHero), instead
          of a bare input dropped onto the page — the search box is the whole point of this page,
          so it gets a proper moment rather than looking like an afterthought. */}
      <div className="border-b border-ink-100 bg-cream-100">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6 sm:py-16 lg:px-8">
          <p className="mb-3 text-xs uppercase tracking-[0.3em] text-brass-500">{query ? "Search" : "Shop"}</p>
          <h1 className="font-display text-3xl text-ink-900 sm:text-4xl">
            {query ? <>Results for &ldquo;{query}&rdquo;</> : "All Products"}
          </h1>
          {!query && (
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-500">
              Browse the full catalog, or search by name, category, or style.
            </p>
          )}
          <div className="mt-8">
            <SearchBox initialValue={query} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-end justify-between">
          <p className="text-sm text-ink-500">
            {query
              ? `${result.total} result${result.total === 1 ? "" : "s"} for “${query}”`
              : `${result.total} product${result.total === 1 ? "" : "s"}`}
          </p>
          <SortSelect hasQuery={Boolean(query)} />
        </div>
        <div className="flex flex-col gap-10 lg:flex-row">
          <FacetFilters facets={facets} />
          <div className="min-w-0 flex-1">
            {result.items.length > 0 && (
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(buildItemListJsonLd(result.items, getSiteUrl())) }}
              />
            )}
            <ProductGrid
              products={result.items}
              emptyState={query ? <NoSearchResults query={query} didYouMean={result.didYouMean} /> : undefined}
            />
            <Pagination page={page} totalPages={totalPages} />
          </div>
        </div>
      </div>
    </div>
  );
}
