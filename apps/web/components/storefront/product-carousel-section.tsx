import type { Product } from "@clothing-brand/shared";
import { ProductCarousel } from "./product-carousel";

interface ProductCarouselSectionProps {
  heading: string;
  subtitle?: string | null;
  /** The listing this section previews ("View all"). */
  href?: string;
  products: Product[];
}

/** Renders one PRODUCT_CAROUSEL homepage section as a two-row product rail: a preview of a listing (featured, newest, a
 * category) with a "View all" link to the full listing, instead of the whole listing stacked on the homepage. The admin
 * builder can add more than one instance, each with its own heading and product source. */
export function ProductCarouselSection({ heading, subtitle, href, products }: ProductCarouselSectionProps) {
  return <ProductCarousel title={heading} subtitle={subtitle} href={href} products={products} rows={2} />;
}
