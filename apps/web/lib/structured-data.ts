import type { ReactNode } from "react";
import { BD_DIVISIONS, type Product, type StoreSettings } from "@clothing-brand/shared";
import { resolveImageUrl } from "./image-url";
import { stripHtml } from "./format";

const NON_DHAKA_DIVISIONS = BD_DIVISIONS.filter((d) => d !== "Dhaka");

// Mirrors the 7-day unworn/tags-attached window described on the /shipping-returns page — kept
// as one literal here since that's the only place the policy is defined; update both together.
const MERCHANT_RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 7,
  returnMethod: "https://schema.org/ReturnByMail",
  returnFees: "https://schema.org/ReturnShippingFeesCustomerResponsibility",
  applicableCountry: "BD",
};

/** Mirrors packages/shared/src/delivery.ts's estimateDelivery exactly: the fee/ETA split is by
 * division === "Dhaka" vs. the other 7 divisions, not a "Dhaka region + country-wide fallback"
 * approximation — listing the 7 explicitly avoids the two bands overlapping (Dhaka is itself
 * inside "BD", so a country-wide second entry would ambiguously match Dhaka addresses too). */
function buildShippingDetails(settings: StoreSettings) {
  return [
    {
      "@type": "OfferShippingDetails",
      shippingRate: { "@type": "MonetaryAmount", value: settings.shippingFeeDhaka, currency: "BDT" },
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "BD", addressRegion: "Dhaka" },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2, unitCode: "DAY" },
        transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2, unitCode: "DAY" },
      },
    },
    {
      "@type": "OfferShippingDetails",
      shippingRate: { "@type": "MonetaryAmount", value: settings.shippingFeeOutsideDhaka, currency: "BDT" },
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "BD", addressRegion: NON_DHAKA_DIVISIONS },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2, unitCode: "DAY" },
        transitTime: { "@type": "QuantitativeValue", minValue: 3, maxValue: 5, unitCode: "DAY" },
      },
    },
  ];
}

export function buildProductJsonLd(product: Product, siteUrl: string, settings: StoreSettings) {
  const price = product.activeFlashSale?.flashPrice ?? product.basePrice;
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription || stripHtml(product.description) || undefined,
    image: product.images.map((img) => resolveImageUrl(img.url)),
    brand: { "@type": "Brand", name: settings.storeName },
    sku: product.variants[0]?.sku,
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/product/${product.slug}`,
      priceCurrency: "BDT",
      price,
      availability: totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      // Every product in the catalog is new stock — there's no used/refurbished concept anywhere
      // in the data model, so this is always accurate rather than an assumed default.
      itemCondition: "https://schema.org/NewCondition",
      hasMerchantReturnPolicy: MERCHANT_RETURN_POLICY,
      shippingDetails: buildShippingDetails(settings),
      // Only set when a flash sale gives a real expiry for the current price — the regular base
      // price has no defined validity window, so it's left open-ended rather than guessed.
      ...(product.activeFlashSale ? { priceValidUntil: product.activeFlashSale.endsAt.slice(0, 10) } : {}),
    },
    // Google only renders the star-rating rich result when this is present — omitted entirely
    // (rather than sent as zero/empty) for an unreviewed product, since an AggregateRating with
    // no ratings is invalid per schema.org and Search Console will flag it.
    ...(product.reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.avgRating,
            reviewCount: product.reviewCount,
          },
        }
      : {}),
  };
}

/** ItemList markup for a product listing page (category/search) — tells Google what's in the grid
 * without re-declaring full Product data per item (that's each product's own page's job); just
 * position + name + url per schema.org's ItemList spec. */
export function buildItemListJsonLd(products: Pick<Product, "name" | "slug">[], siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: products.map((product, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: product.name,
      url: `${siteUrl}/product/${product.slug}`,
    })),
  };
}

/** FAQPage rich-result markup — Google can surface these as expandable Q&A directly in search
 * results. `groups` is the same flat list of { question, answer } the visible accordion renders,
 * so the two can never drift out of sync. */
export function buildFaqJsonLd(groups: { items: { question: string; answer: ReactNode }[] }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    // JSON-LD needs plain text — an answer authored as JSX (rather than a plain string) can't be
    // represented here, so it's left out of the rich-result markup rather than stringified wrong.
    mainEntity: groups.flatMap((group) =>
      group.items
        .filter((item): item is { question: string; answer: string } => typeof item.answer === "string")
        .map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
    ),
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
    // Eligibility (not a guarantee) for Google's sitelinks searchbox under the site's search result.
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}
