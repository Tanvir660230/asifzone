import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ProductSort } from "@clothing-brand/shared";
import { Breadcrumb, categoryBreadcrumbTrail } from "@/components/storefront/breadcrumb";
import { ProductGrid } from "@/components/storefront/product-grid";
import { SortSelect } from "@/components/storefront/sort-select";
import { Pagination } from "@/components/storefront/pagination";
import { FacetFilters } from "@/components/storefront/facet-filters";
import { ComingSoon } from "@/components/storefront/coming-soon";
import { getCategoryBySlug, getStorefrontFacets, listStorefrontProducts } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { env } from "@/lib/env";

const PAGE_SIZE = 12;

interface Props {
  params: { slug: string };
  searchParams: { sort?: string; page?: string; sizes?: string; colors?: string; minPrice?: string; maxPrice?: string };
}

async function loadCategory(slug: string) {
  try {
    return await getCategoryBySlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const data = await loadCategory(params.slug);
  if (!data) return { title: "Category" };

  const { category } = data;
  const title = category.seoTitle || category.name;
  const description = category.seoDescription || undefined;
  const page = Number(searchParams.page) || 1;
  const url = `${getSiteUrl()}/category/${category.slug}${page > 1 ? `?page=${page}` : ""}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    ...buildOpenGraph({
      title,
      description,
      url,
      images: category.imageUrl
        ? [category.imageUrl.startsWith("http") ? category.imageUrl : `${env.apiUrl}${category.imageUrl}`]
        : undefined,
    }),
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const data = await loadCategory(params.slug);
  if (!data) notFound();

  const { category, breadcrumb } = data;
  const page = Number(searchParams.page) || 1;
  const sort = (searchParams.sort as ProductSort) || "newest";
  const sizes = searchParams.sizes?.split(",").filter(Boolean);
  const colors = searchParams.colors?.split(",").filter(Boolean);
  const minPrice = searchParams.minPrice ? Number(searchParams.minPrice) : undefined;
  const maxPrice = searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined;

  const [result, facets] = await Promise.all([
    listStorefrontProducts({ category: params.slug, sort, page, pageSize: PAGE_SIZE, sizes, colors, minPrice, maxPrice }),
    getStorefrontFacets({ category: params.slug }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  // Nothing to sort/filter when the category itself is empty — that's "coming soon," not a
  // filter dead-end. A zero-result *filtered* search still gets the normal layout so the shopper
  // can see (and clear) what they filtered by, via ProductGrid's plain default empty state.
  const isFiltered = Boolean(sizes?.length || colors?.length || minPrice !== undefined || maxPrice !== undefined);
  const isEmptyCategory = result.total === 0 && !isFiltered;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumb trail={categoryBreadcrumbTrail(breadcrumb, category)} />
      <div className="mb-8 mt-4 flex items-end justify-between">
        <h1 className="font-display text-3xl text-ink-900">{category.name}</h1>
        {!isEmptyCategory && <SortSelect />}
      </div>

      {isEmptyCategory ? (
        <ComingSoon categoryName={category.name} />
      ) : (
        <div className="flex gap-10">
          <FacetFilters facets={facets} />
          <div className="flex-1">
            <ProductGrid products={result.items} />
            <Pagination page={page} totalPages={totalPages} />
          </div>
        </div>
      )}
    </div>
  );
}
