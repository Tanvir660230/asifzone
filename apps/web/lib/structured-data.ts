import type { Product, StoreSettings } from "@clothing-brand/shared";
import { resolveImageUrl } from "./image-url";

export function buildProductJsonLd(product: Product, siteUrl: string, storeName: string) {
  const price = product.activeFlashSale?.flashPrice ?? product.basePrice;
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: product.images.map((img) => resolveImageUrl(img.url)),
    brand: { "@type": "Brand", name: storeName },
    sku: product.variants[0]?.sku,
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/product/${product.slug}`,
      priceCurrency: "BDT",
      price,
      availability: totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
}

/** Mirrors the exact trail the visible `<Breadcrumb>` renders (Home prepended, same order) — kept
 * in lockstep by construction since both are built from the same `trail` prop in that component.
 * The current (last, un-linked) entry omits `item`, matching Google's own BreadcrumbList examples. */
export function buildBreadcrumbJsonLd(trail: Array<{ name: string; href?: string }>, siteUrl: string) {
  const items = [{ name: "Home", href: "/" }, ...trail];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.href ? { item: `${siteUrl}${item.href}` } : {}),
    })),
  };
}

export function buildOrganizationJsonLd(settings: StoreSettings, siteUrl: string) {
  const hasContact = Boolean(settings.contactEmail || settings.contactPhone);
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: settings.storeName,
    url: siteUrl,
    logo: settings.logoUrl || undefined,
    ...(hasContact
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(settings.contactEmail ? { email: settings.contactEmail } : {}),
            ...(settings.contactPhone ? { telephone: settings.contactPhone } : {}),
          },
        }
      : {}),
  };
}

export function buildWebsiteJsonLd(settings: StoreSettings, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.storeName,
    url: siteUrl,
  };
}
