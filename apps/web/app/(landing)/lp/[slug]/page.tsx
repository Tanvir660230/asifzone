import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";
import { Banknote, Phone, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { deliverySpan, storePolicy } from "@clothing-brand/shared";
import { StoreLogoImage } from "@/components/store-logo-image";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { ProductReviews } from "@/components/storefront/product-reviews";
import { StarRating } from "@/components/storefront/star-rating";
import { TrackProductView } from "@/components/storefront/track-product-view";
import { LandingOrderForm } from "@/components/landing/landing-order-form";
import { LandingStickyCta } from "@/components/landing/landing-sticky-cta";
import { getActiveSocialLinksSafe, getProductBySlug, getSiteSettings } from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { percentOffLabel, productDisplayPrice } from "@/lib/pricing-display";
import { productSeoFields, storeTitle, buildOpenGraph } from "@/lib/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

// Live stock and price on every visit — an ad sends people here at any moment.
export const dynamic = "force-dynamic";

async function loadProduct(slug: string) {
  try {
    return (await getProductBySlug(slug)).product;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const [product, { settings }] = await Promise.all([loadProduct(slug), getSiteSettings()]);
  if (!product) return { title: "Product not found" };
  const { title, description, canonical, og } = productSeoFields(product);
  return {
    title: storeTitle(title, settings.storeName),
    description,
    // The same product as /product/[slug]: search engines index that page; this one is for ads.
    alternates: { canonical },
    robots: { index: false, follow: true },
    ...buildOpenGraph({ title: og.title, description: og.description, url: canonical, siteName: settings.storeName, images: og.images }),
  };
}

export default async function ProductLandingPage({ params }: Props) {
  const { slug } = await params;
  const [product, { settings }, { links }] = await Promise.all([loadProduct(slug), getSiteSettings(), getActiveSocialLinksSafe()]);
  if (!product) notFound();

  // A server component formats money in the store's own currency explicitly (lib/store-config.ts).
  const money = (value: string | number) => formatPrice(value, settings.currency);
  const shown = productDisplayPrice(product);
  const hasWas = shown.was !== null && Number(shown.was) > Number(shown.price);
  const policy = storePolicy(settings);
  const [fastest, slowest] = deliverySpan(policy);
  const description = DOMPurify.sanitize(product.description ?? "");
  const whatsapp = links.find((l) => l.platform === "WHATSAPP" && l.isActive)?.url ?? null;
  const phone = settings.contactPhone;

  const promises = [
    { icon: Truck, title: "সারা দেশে হোম ডেলিভারি", text: `${fastest === slowest ? fastest : `${fastest}–${slowest}`} দিনের মধ্যে` },
    { icon: Banknote, title: "ক্যাশ অন ডেলিভারি", text: "পণ্য হাতে পেয়ে টাকা দিন" },
    ...(policy.returns ? [{ icon: RotateCcw, title: `${policy.returns.days} দিনে সহজ রিটার্ন`, text: "সমস্যা হলে বদলে নিন" }] : []),
    { icon: ShieldCheck, title: "১০০% অরিজিনাল", text: `${settings.storeName}-এর নিজস্ব পণ্য` },
  ];

  return (
    <>
      <TrackProductView productId={product.id} productName={product.name} categoryId={product.categoryId} price={Number(shown.price)} />

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex items-center" aria-label={settings.storeName}>
            {settings.logoUrl ? (
              <StoreLogoImage src={resolveImageUrl(settings.logoUrl)} alt={settings.storeName} className="h-8 w-32 object-contain object-left" fallback={<span className="font-display text-lg text-fg">{settings.storeName}</span>} />
            ) : (
              <span className="font-display text-lg text-fg">{settings.storeName}</span>
            )}
          </Link>
          {phone && (
            <a href={`tel:${phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-2 rounded-[var(--control-radius)] border border-line px-3 py-2 text-sm font-medium text-fg" lang="bn">
              <Phone size={15} aria-hidden="true" />
              কল করুন
            </a>
          )}
        </div>
      </header>

      <main id="main-content" className="flex-1 pb-28 lg:pb-16" lang="bn">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-4 sm:pt-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
          <div className="lg:sticky lg:top-6 lg:self-start">
            <ProductGallery images={product.images} productName={product.name} />
          </div>

          <div>
            <h1 className="ui-product-title text-fg" lang="en">
              {product.name}
            </h1>
            {product.reviewCount > 0 && (
              <a href="#reviews" className="mt-2 flex items-center gap-2 text-sm text-fg-muted">
                <StarRating value={product.avgRating} />
                <span>
                  {product.avgRating.toFixed(1)} · {product.reviewCount}টি রিভিউ
                </span>
              </a>
            )}

            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-bold tabular-nums text-fg" data-testid="landing-price">
                {money(shown.price)}
              </span>
              {hasWas && (
                <>
                  <span className="text-lg tabular-nums text-fg-muted line-through">{money(shown.was!)}</span>
                  <span className="rounded-full bg-sale-50 px-2.5 py-1 text-sm font-semibold text-sale-600">{percentOffLabel(shown.price, shown.was!)}% ছাড়</span>
                </>
              )}
            </div>
            {product.shortDescription && <p className="mt-3 text-base leading-relaxed text-fg-muted" lang="en">{product.shortDescription}</p>}

            <ul className="mt-6 grid grid-cols-2 gap-3">
              {promises.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3">
                  <Icon size={20} className="mt-0.5 shrink-0 text-fg" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-snug text-fg">{title}</span>
                    <span className="block text-xs leading-snug text-fg-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ul>

            <section id="order" className="mt-8 scroll-mt-4 rounded-xl border-2 border-ink-900 bg-surface p-4 shadow-float sm:p-6" aria-labelledby="order-title">
              <h2 id="order-title" className="text-xl font-bold text-fg">
                অর্ডার করতে নিচের তথ্য দিন
              </h2>
              <p className="mb-5 mt-1 text-sm text-fg-muted">আমরা ফোন করে অর্ডার কনফার্ম করব, তারপর পাঠিয়ে দেব।</p>
              <LandingOrderForm product={product} codEnabled={settings.codEnabled} />
            </section>

            {(phone || whatsapp) && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-fg-muted">
                <span>অর্ডার করতে সমস্যা হচ্ছে?</span>
                {phone && (
                  <a href={`tel:${phone.replace(/\s+/g, "")}`} className="font-semibold text-fg underline underline-offset-4">
                    কল করুন {phone}
                  </a>
                )}
                {whatsapp && (
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="font-semibold text-fg underline underline-offset-4">
                    WhatsApp করুন
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {description.trim() && (
          <section className="mx-auto mt-12 max-w-3xl px-4" aria-labelledby="details-title">
            <h2 id="details-title" className="mb-4 text-xl font-bold text-fg">
              পণ্যের বিস্তারিত
            </h2>
            <div className="prose prose-sm max-w-none text-fg" lang="en" dangerouslySetInnerHTML={{ __html: description }} />
          </section>
        )}

        <section id="reviews" className="mx-auto mt-12 max-w-3xl scroll-mt-4 px-4">
          <ProductReviews productId={product.id} productName={product.name} />
        </section>

        <div className="mx-auto mt-12 max-w-3xl px-4 text-center">
          <a href="#order" className="inline-flex h-14 w-full max-w-md items-center justify-center rounded-[var(--control-radius)] bg-ink-900 px-8 text-base font-semibold text-cream-50">
            এখনই অর্ডার করুন — {money(shown.price)}
          </a>
        </div>
      </main>

      <footer className="border-t border-line bg-surface py-6 text-center text-xs text-fg-muted">
        <p>
          © {new Date().getFullYear()} {settings.storeName}
        </p>
        <nav aria-label="Policies" className="mt-2 flex justify-center gap-4">
          <Link href="/shipping-returns">Shipping &amp; returns</Link>
          <Link href="/privacy-policy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </footer>

      <LandingStickyCta price={money(shown.price)} was={hasWas ? money(shown.was!) : null} />
    </>
  );
}
