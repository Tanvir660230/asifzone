import type { ComponentProps } from "react";
import type { Product } from "@clothing-brand/shared";
import { Breadcrumb } from "@/components/storefront/breadcrumb";
import { ProductShowcase } from "@/components/storefront/product-showcase";
import type { SpecAccordionItem } from "@/lib/product-specs";

interface ProductPageBodyProps {
  product: Product;
  urgencySignals: ComponentProps<typeof ProductShowcase>["urgencySignals"];
  /** Already sanitized by the caller (see buildAccordionItems). */
  accordionItems: SpecAccordionItem[];
  showSizeGuideLink: boolean;
}

/** The part of the product page that shows the product itself: breadcrumb, gallery, price, options, accordion.
 * No data fetching and no server-only code, so the live route (via ProductPageView, a server component) and the
 * admin wizard's live preview (a client page fed unsaved form state) render literally the same component tree. */
export function ProductPageBody({ product, urgencySignals, accordionItems, showSizeGuideLink }: ProductPageBodyProps) {
  return (
    <>
      <Breadcrumb trail={[{ name: product.category.name, href: `/category/${product.category.slug}` }, { name: product.name }]} />
      <ProductShowcase product={product} urgencySignals={urgencySignals} accordionItems={accordionItems} showSizeGuideLink={showSizeGuideLink} />
    </>
  );
}
