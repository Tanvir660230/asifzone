import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Product, PublicLandingPage } from "@clothing-brand/shared";
import { CampaignLandingView, campaignProduct } from "@/components/landing/campaign-landing-view";
import { apiBaseUrl } from "@/lib/runtime-config";

// The working copy changes with every save, and the page is only ever meant for the admin who asked for it.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Landing page preview", robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ id: string }>;
}

/** A campaign landing page's working copy exactly as visitors will see it once published — the editor's live preview.
 * Both reads use the admin's own session (admin-only endpoints), so a guessed URL shows nothing to a customer. */
export default async function LandingPreviewPage({ params }: Props) {
  const { id } = await params;
  const accessToken = (await cookies()).get("access_token")?.value;
  if (!accessToken) redirect("/admin/login");
  const auth = { headers: { cookie: `access_token=${accessToken}` }, cache: "no-store" as const };

  const pageRes = await fetch(`${apiBaseUrl()}/api/landing-pages/${encodeURIComponent(id)}/preview`, auth);
  if (pageRes.status === 401 || pageRes.status === 403) redirect("/admin/login");
  if (!pageRes.ok) notFound();
  const { page } = (await pageRes.json()) as { page: PublicLandingPage & { productStatus: string } };

  const loadProduct = async (productId: string) => {
    const res = await fetch(`${apiBaseUrl()}/api/products/${encodeURIComponent(productId)}/preview`, auth);
    return res.ok ? ((await res.json()) as { product: Product }).product : null;
  };
  const [product, ...extras] = await Promise.all([loadProduct(page.content.productId), ...(page.content.extraProductIds ?? []).map(loadProduct)]);
  if (!product) notFound();
  const unpublishedExtras = extras.filter((p) => p && p.status !== "PUBLISHED").map((p) => p!.name);

  const banner =
    page.productStatus !== "PUBLISHED" ? (
      <p className="bg-warning-50 px-4 py-2 text-center text-sm font-medium text-warning-800" role="status" lang="en">
        Preview — this product isn&apos;t published, so the page can&apos;t take orders until it is.
      </p>
    ) : unpublishedExtras.length ? (
      <p className="bg-warning-50 px-4 py-2 text-center text-sm font-medium text-warning-800" role="status" lang="en">
        Preview — {unpublishedExtras.join(", ")} {unpublishedExtras.length === 1 ? "isn't" : "aren't"} published yet; publish {unpublishedExtras.length === 1 ? "it" : "them"} before publishing this page.
      </p>
    ) : null;
  return (
    <CampaignLandingView page={page} product={campaignProduct(product, extras.filter((p): p is Product => p !== null), page.content)} previewBanner={banner} />
  );;
}
