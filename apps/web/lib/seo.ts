import type { Metadata } from "next";
import type { Product } from "@clothing-brand/shared";
import { stripHtml } from "./format";
import { resolveImageUrl } from "./image-url";

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

interface OpenGraphOptions {
  title: string;
  description?: string;
  url: string;
  siteName?: string;
  images?: string[];
}

/** Shared `openGraph`/`twitter` metadata block — every page assembles the same shape instead of
 * hand-rolling it, so link previews (Facebook/LinkedIn/Slack via OG, X via Twitter Card) stay consistent. */
export function buildOpenGraph({ title, description, url, siteName, images }: OpenGraphOptions): Pick<Metadata, "openGraph" | "twitter"> {
  const hasImage = Boolean(images && images.length > 0);
  return {
    openGraph: {
      title,
      description,
      url,
      siteName,
      images,
      type: "website",
    },
    twitter: {
      card: hasImage ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
  };
}

type SeoSource = Pick<Product, "name" | "slug" | "description" | "shortDescription" | "seoTitle" | "seoDescription" | "canonicalUrl" | "ogTitle" | "ogDescription" | "ogImageUrl" | "images">;

/** What a product page tells search engines and link previews — the storefront's generateMetadata and the admin
 * wizard's SERP/social previews both read this, so the preview shows exactly what the live page will emit. */
export function productSeoFields(product: SeoSource, siteUrl = getSiteUrl()) {
  const title = product.seoTitle || product.name;
  const description = product.seoDescription || product.shortDescription || stripHtml(product.description) || undefined;
  const ownUrl = `${siteUrl}/product/${product.slug}`;
  // An explicit canonical (e.g. this product is a variant listing of another page) wins; otherwise it points at itself.
  const canonical = product.canonicalUrl || ownUrl;
  return {
    title,
    description,
    canonical,
    // Social previews use their own overrides when set, and fall back to what search results show.
    og: {
      title: product.ogTitle || title,
      description: product.ogDescription || description,
      images: product.ogImageUrl ? [product.ogImageUrl] : product.images.map((img) => resolveImageUrl(img.url)),
    },
  };
}
