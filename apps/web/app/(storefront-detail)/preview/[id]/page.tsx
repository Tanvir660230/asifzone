import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Product } from "@clothing-brand/shared";
import { ProductPageView } from "@/components/storefront/product-page-view";
import { env } from "@/lib/env";

// A draft can change between two looks, and the page is only ever meant for the admin who asked for it.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ id: string }>;
}

/** The admin's view of a product exactly as the storefront renders it — including drafts. The data comes from an
 * admin-only endpoint using the admin's own session cookie, so a customer who guesses this URL gets sent to the login
 * page and sees nothing; the page itself is the same `ProductPageView` the live route renders. */
export default async function ProductPreviewPage({ params }: Props) {
  const { id } = await params;
  const accessToken = (await cookies()).get("access_token")?.value;
  if (!accessToken) redirect("/admin/login");

  const res = await fetch(`${env.apiUrl}/api/products/${encodeURIComponent(id)}/preview`, {
    headers: { cookie: `access_token=${accessToken}` },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) redirect("/admin/login");
  if (!res.ok) notFound();

  const { product } = (await res.json()) as { product: Product & { previewStatus?: string } };
  return <ProductPageView product={product} mode="preview" previewStatus={product.previewStatus} />;
}
