import type { Product } from "@clothing-brand/shared";
import { ProductGrid } from "./product-grid";

interface ProductCarouselSectionProps {
  heading: string;
  subtitle?: string | null;
  products: Product[];
}

/** Renders one PRODUCT_CAROUSEL homepage section — extracted from the old inline featured-products
 * block in page.tsx so the admin builder can add more than one instance (e.g. a second carousel
 * scoped to a category), each with its own heading/product source. */
export function ProductCarouselSection({ heading, subtitle, products }: ProductCarouselSectionProps) {
  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-8 text-center">
        <h2 className="font-display text-2xl text-ink-900">{heading}</h2>
        {subtitle && <p className="mt-2 text-sm text-ink-500">{subtitle}</p>}
      </div>
      <ProductGrid products={products} />
    </section>
  );
}
