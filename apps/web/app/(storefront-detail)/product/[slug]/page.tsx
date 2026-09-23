import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ProductPageView } from "@/components/storefront/product-page-view";
import { getProductBySlug } from "@/lib/api/storefront";
import { buildOpenGraph, productSeoFields } from "@/lib/seo";

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

  const { title, description, canonical, og } = productSeoFields(data.product);
  return {
    title,
    description,
    alternates: { canonical },
    ...buildOpenGraph({ title: og.title, description: og.description, url: canonical, images: og.images }),
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const data = await loadProduct(slug);
  if (!data) notFound();

  return <ProductPageView product={data.product} mode="live" />;
}
