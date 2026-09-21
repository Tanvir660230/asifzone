import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductPageView } from "@/components/storefront/product-page-view";
import { getProductBySlug } from "@/lib/api/storefront";
import { stripHtml } from "@/lib/format";
import { getSiteUrl, buildOpenGraph } from "@/lib/seo";
import { resolveImageUrl } from "@/lib/image-url";

interface Props {
  // Next.js 15: params is a Promise on server components (was a plain object pre-15) — must be
  // awaited before use.
  params: Promise<{ slug: string }>;
}

async function loadProduct(slug: string) {
  try {
    return await getProductBySlug(slug);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) return { title: "Product" };

  const { product } = data;
  const title = product.seoTitle || product.name;
  const description = product.seoDescription || product.shortDescription || stripHtml(product.description) || undefined;
  const ownUrl = `${getSiteUrl()}/product/${product.slug}`;
  // An explicit canonical (e.g. this product is a variant listing of another page) wins; otherwise it points at itself.
  const canonical = product.canonicalUrl || ownUrl;

  return {
    title,
    description,
    alternates: { canonical },
    ...buildOpenGraph({
      // Social previews use their own overrides when set, and fall back to what search results show.
      title: product.ogTitle || title,
      description: product.ogDescription || description,
      url: canonical,
      images: product.ogImageUrl ? [product.ogImageUrl] : product.images.map((img) => resolveImageUrl(img.url)),
    }),
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) notFound();

  return <ProductPageView product={data.product} mode="live" />;
}
