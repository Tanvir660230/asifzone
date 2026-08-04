import type { Product } from "@clothing-brand/shared";
import { env } from "./env";
import { siteConfig } from "./site-config";

export function buildProductJsonLd(product: Product, siteUrl: string) {
  const price = product.activeFlashSale?.flashPrice ?? product.basePrice;
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: product.images.map((img) => `${env.apiUrl}${img.url}`),
    brand: { "@type": "Brand", name: siteConfig.name },
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
