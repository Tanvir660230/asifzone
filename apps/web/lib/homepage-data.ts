import type { FeaturedReview, HomepageSectionType, ProductCarouselConfig, TestimonialsConfig } from "@clothing-brand/shared";
import { getFeaturedReviews, listStorefrontProducts } from "@/lib/api/storefront";

/** A homepage section as the renderer needs it — a live row or a Studio draft section (same fields). */
export interface RenderableSection {
  id: string;
  type: HomepageSectionType;
  config: Record<string, unknown>;
}

/** "featured" falls back to newest-first when nothing is currently marked featured — same item-selection behavior the
 * homepage always had, keyed off the section's own config. The heading is whatever the admin set for this section. */
export async function resolveProductCarouselProducts(config: ProductCarouselConfig) {
  const { source, category, itemCount } = config;
  if (source === "category" && category) return listStorefrontProducts({ category, pageSize: itemCount });
  if (source === "new") return listStorefrontProducts({ pageSize: itemCount });
  const featured = await listStorefrontProducts({ featured: true, pageSize: itemCount });
  return featured.items.length > 0 ? featured : listStorefrontProducts({ pageSize: itemCount });
}

/** The full listing a homepage product section previews (its "View all" link). */
export function carouselListingHref({ source, category }: ProductCarouselConfig): string {
  if (source === "category" && category) return `/category/${category}`;
  if (source === "new") return "/search?sort=newest";
  return "/search";
}

/** The review fetches the page's "Customer reviews" sections need: one per star threshold, each for the most reviews any
 * section with that threshold shows — so every section gets its own newest N at its own rating (`reviewsFor`). */
export function featuredReviewsQueries(sections: RenderableSection[]) {
  const counts = new Map<number, number>();
  for (const s of sections) {
    if (s.type !== "TESTIMONIALS") continue;
    const config = s.config as Partial<TestimonialsConfig>;
    const rating = config.minRating ?? 4;
    counts.set(rating, Math.max(counts.get(rating) ?? 0, config.count ?? 6));
  }
  return [...counts].sort(([a], [b]) => a - b).map(([minRating, count]) => ({ minRating, count }));
}

export async function loadFeaturedReviews(sections: RenderableSection[]): Promise<FeaturedReview[]> {
  const queries = featuredReviewsQueries(sections);
  if (queries.length === 0) return [];
  try {
    const results = await Promise.all(queries.map((q) => getFeaturedReviews(q)));
    const byId = new Map(results.flatMap((r) => r.reviews).map((r) => [r.id, r]));
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    // Reviews are a nice-to-have on the homepage: an outage hides the section rather than failing the page.
    return [];
  }
}

export function reviewsFor(config: Partial<TestimonialsConfig>, reviews: FeaturedReview[]) {
  return reviews.filter((r) => r.rating >= (config.minRating ?? 4)).slice(0, config.count ?? 6);
}
