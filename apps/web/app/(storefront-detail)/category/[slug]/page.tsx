import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ProductSort } from "@clothing-brand/shared";
import { categoryBreadcrumbTrail } from "@/components/storefront/breadcrumb";
import { StorefrontPage, StorefrontPageHeader } from "@/components/storefront/storefront-page";
import { ProductGrid } from "@/components/storefront/product-grid";
import { SortSelect } from "@/components/storefront/sort-select";
import { Pagination } from "@/components/storefront/pagination";
import { FacetFilters } from "@/components/storefront/facet-filters";
import { ComingSoon } from "@/components/storefront/coming-soon";
import { CategoryStockPanel } from "@/components/storefront/category-stock-panel";
import { getCategoryBySlug, getCategoryStockOverview, getSiteSettings, getStorefrontFacets, listStorefrontProducts } from "@/lib/api/storefront";
import { getSiteUrl, buildOpenGraph, storeTitle } from "@/lib/seo";
import { buildItemListJsonLd } from "@/lib/structured-data";
import { resolveImageUrl } from "@/lib/image-url";
import { jsonLdString } from "@clothing-brand/shared";

const PAGE_SIZE = 12;

interface Props {
  // Next.js 15: both params and searchParams are Promises on server components (were plain
  // objects pre-15) — must be awaited before use.
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; page?: string; sizes?: string; colors?: string; minPrice?: string; maxPrice?: string }>;
}

async function loadCategory(slug: string) {
  try {
    return await getCategoryBySlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const [data, { settings }] = await Promise.all([loadCategory(slug), getSiteSettings()]);
  if (!data) return { title: "Category not found" };

  const { category } = data;
  const title = category.seoTitle || category.name;
  const description = category.seoDescription || undefined;
  const page = Number(resolvedSearchParams.page) || 1;
  const url = `${getSiteUrl()}/category/${category.slug}${page > 1 ? `?page=${page}` : ""}`;

  return {
    title: storeTitle(title, settings.storeName),
    description,
    alternates: { canonical: url },
    ...buildOpenGraph({
      title,
      description,
      url,
      siteName: settings.storeName,
      images: category.imageUrl ? [resolveImageUrl(category.imageUrl)] : undefined,
    }),
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const data = await loadCategory(slug);
  if (!data) notFound();

  const { category, breadcrumb } = data;
  const page = Number(resolvedSearchParams.page) || 1;
  const sort = (resolvedSearchParams.sort as ProductSort) || "newest";
  const sizes = resolvedSearchParams.sizes?.split(",").filter(Boolean);
  const colors = resolvedSearchParams.colors?.split(",").filter(Boolean);
  const minPrice = resolvedSearchParams.minPrice ? Number(resolvedSearchParams.minPrice) : undefined;
  const maxPrice = resolvedSearchParams.maxPrice ? Number(resolvedSearchParams.maxPrice) : undefined;

  const [result, facets, stockOverview] = await Promise.all([
    listStorefrontProducts({ category: slug, sort, page, pageSize: PAGE_SIZE, sizes, colors, minPrice, maxPrice }),
    getStorefrontFacets({ category: slug }),
    getCategoryStockOverview(slug),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  // Nothing to sort/filter when the category itself is empty — that's "coming soon," not a
  // filter dead-end. A zero-result *filtered* search still gets the normal layout so the shopper
  // can see (and clear) what they filtered by, via ProductGrid's plain default empty state.
  const isFiltered = Boolean(sizes?.length || colors?.length || minPrice !== undefined || maxPrice !== undefined);
  const isEmptyCategory = result.total === 0 && !isFiltered;

  return (
    <StorefrontPage>
      {/* Sort sits beside the title from 1024px; on phones it lives in the pinned Filters bar. */}
      <StorefrontPageHeader
        breadcrumb={categoryBreadcrumbTrail(breadcrumb, category)}
        title={category.name}
        actions={
          !isEmptyCategory ? (
            <div className="hidden lg:block">
              <SortSelect />
            </div>
          ) : undefined
        }
      />

      {isEmptyCategory ? (
        <ComingSoon categoryName={category.name} />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-10">
          {/* On phones the column dissolves (`contents`), so the filter toolbar inside it can stay pinned over the grid. */}
          <div className="w-full max-lg:contents lg:w-56 lg:shrink-0">
            <h2 className="sr-only">Refine</h2>
            <CategoryStockPanel overview={stockOverview} />
            <FacetFilters facets={facets} toolbarExtra={<SortSelect className="w-44" />} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="sr-only">Products</h2>
            {result.items.length > 0 && (
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: jsonLdString(buildItemListJsonLd(result.items, getSiteUrl())) }}
              />
            )}
            <ProductGrid products={result.items} priority />
            <Pagination page={page} totalPages={totalPages} />
          </div>
        </div>
      )}
    </StorefrontPage>
  );
}
