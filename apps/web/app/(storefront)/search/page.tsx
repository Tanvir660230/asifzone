import { SearchBox } from "@/components/storefront/search-box";
import { ProductGrid } from "@/components/storefront/product-grid";
import { FacetFilters } from "@/components/storefront/facet-filters";
import { getStorefrontFacets, listStorefrontProducts } from "@/lib/api/storefront";

interface Props {
  searchParams: { q?: string; sizes?: string; colors?: string; minPrice?: string; maxPrice?: string };
}

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: Props) {
  const query = searchParams.q?.trim();
  const sizes = searchParams.sizes?.split(",").filter(Boolean);
  const colors = searchParams.colors?.split(",").filter(Boolean);
  const minPrice = searchParams.minPrice ? Number(searchParams.minPrice) : undefined;
  const maxPrice = searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined;

  const [result, facets] = query
    ? await Promise.all([
        listStorefrontProducts({ search: query, pageSize: 24, sizes, colors, minPrice, maxPrice }),
        getStorefrontFacets({ search: query }),
      ])
    : [null, null];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <SearchBox initialValue={query} />

      <div className="mt-10">
        {!query && <p className="text-center text-ink-400">Start typing to search the catalog.</p>}
        {query && (
          <>
            <p className="mb-6 text-sm text-ink-500">
              {result!.total} result{result!.total === 1 ? "" : "s"} for &ldquo;{query}&rdquo;
            </p>
            <div className="flex gap-10">
              {facets && <FacetFilters facets={facets} />}
              <div className="flex-1">
                <ProductGrid products={result!.items} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
