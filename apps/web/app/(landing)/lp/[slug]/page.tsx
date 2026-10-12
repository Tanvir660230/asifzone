import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";
import { Banknote, ChevronDown, MessageCircle, Phone, RotateCcw, Star, Truck } from "lucide-react";
import { storePolicy } from "@clothing-brand/shared";
import { StoreLogoImage } from "@/components/store-logo-image";
import { ProductReviews } from "@/components/storefront/product-reviews";
import { TrackProductView } from "@/components/storefront/track-product-view";
import { LandingGallery } from "@/components/landing/landing-gallery";
import { LandingOrderForm } from "@/components/landing/landing-order-form";
import { LandingStickyCta } from "@/components/landing/landing-sticky-cta";
import { LandingMoreProducts } from "@/components/landing/landing-more-products";
import { getActiveSocialLinksSafe, getProductBySlug, getSiteSettings } from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { percentOffLabel, productDisplayPrice } from "@/lib/pricing-display";
import { productSeoFields, storeTitle, buildOpenGraph } from "@/lib/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

// Live stock and price on every visit: an ad sends people here at any moment.
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

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (value: number | string) => String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);
const range = ([a, b]: readonly [number, number]) => (a === b ? bn(a) : `${bn(a)}-${bn(b)}`);

export default async function ProductLandingPage({ params }: Props) {
  const { slug } = await params;
  const [product, { settings }, { links }] = await Promise.all([loadProduct(slug), getSiteSettings(), getActiveSocialLinksSafe()]);
  if (!product) notFound();

  // A server component formats money in the store's own currency explicitly (lib/store-config.ts).
  const money = (value: string | number) => formatPrice(value, settings.currency);
  const shown = productDisplayPrice(product);
  const hasWas = shown.was !== null && Number(shown.was) > Number(shown.price);
  const policy = storePolicy(settings);
  const { insideDhaka, outsideDhaka } = policy.deliveryDays;
  const description = DOMPurify.sanitize(product.description ?? "");
  const whatsapp = links.find((l) => l.platform === "WHATSAPP" && l.isActive)?.url ?? null;
  const phone = settings.contactPhone;
  const tel = phone ? `tel:${phone.replace(/\s+/g, "")}` : null;

  const promises = [
    { icon: Truck, title: "সারা দেশে হোম ডেলিভারি", text: `${range([Math.min(insideDhaka[0], outsideDhaka[0]), Math.max(insideDhaka[1], outsideDhaka[1])])} দিনে পৌঁছে যাবে` },
    { icon: Banknote, title: "ক্যাশ অন ডেলিভারি", text: "পণ্য হাতে পেয়ে দাম দিন" },
    ...(policy.returns ? [{ icon: RotateCcw, title: `${bn(policy.returns.days)} দিনের সহজ রিটার্ন`, text: "পছন্দ না হলে বদলে নিন" }] : []),
  ];

  // Real answers from this store's own settings and policy: nothing here is promised that the store hasn't set.
  const faqs = [
    { q: "অর্ডার করলে কত দিনে হাতে পাব?", a: `ঢাকার ভেতরে ${range(insideDhaka)} দিনে, ঢাকার বাইরে ${range(outsideDhaka)} দিনে।` },
    {
      q: "ডেলিভারি চার্জ কত?",
      a: `ঢাকার ভেতরে ${money(settings.shippingFeeDhaka)}, ঢাকার বাইরে ${money(settings.shippingFeeOutsideDhaka)}। অর্ডার ফর্মে জেলা দিলেই ডেলিভারিসহ মোট দাম দেখতে পাবেন।`,
    },
    { q: "আগে টাকা দিতে হবে কি?", a: "না। অর্ডার করতে কোনো অগ্রিম টাকা লাগবে না। ডেলিভারিম্যানের কাছ থেকে পণ্য হাতে পেয়ে তারপর মূল্য পরিশোধ করবেন।" },
    ...(policy.returns
      ? [
          {
            q: "পণ্য পছন্দ না হলে বা সাইজ না মিললে?",
            a: `ডেলিভারির ${bn(policy.returns.days)} দিনের মধ্যে রিটার্ন বা সাইজ বদল করতে পারবেন।${policy.returns.conditions ? ` শর্ত: ${policy.returns.conditions}।` : ""}`,
          },
        ]
      : []),
    { q: "অর্ডার করার পর কী হবে?", a: "অর্ডার পাওয়ার পর আমাদের প্রতিনিধি আপনার নম্বরে ফোন করে সাইজ ও ঠিকানা নিশ্চিত করবেন, তারপর পণ্যটি পাঠিয়ে দেওয়া হবে।" },
  ];

  return (
    <>
      <TrackProductView productId={product.id} productName={product.name} categoryId={product.categoryId} price={Number(shown.price)} />

      <header className="sticky top-0 z-dock border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="flex min-w-0 items-center" aria-label={settings.storeName}>
            {settings.logoUrl ? (
              <StoreLogoImage
                src={resolveImageUrl(settings.logoUrl)}
                alt={settings.storeName}
                className="h-8 w-32 object-contain object-left"
                fallback={<span className="truncate font-display text-lg text-fg">{settings.storeName}</span>}
              />
            ) : (
              <span className="truncate font-display text-lg text-fg">{settings.storeName}</span>
            )}
          </Link>
          {tel && (
            <a href={tel} className="inline-flex h-10 items-center gap-2 rounded-[var(--control-radius)] bg-surface-muted px-4 text-sm font-semibold text-fg" lang="bn">
              <Phone size={16} aria-hidden="true" />
              কল করুন
            </a>
          )}
        </div>
      </header>

      <main id="main-content" className="flex-1 pb-28 lg:pb-20" lang="bn">
        <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12 lg:px-4 lg:pt-8">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <LandingGallery images={product.images} productName={product.name} />
          </div>

          <div className="px-4 pt-5 lg:px-0 lg:pt-0">
            <h1 className="font-display text-2xl font-semibold leading-tight text-fg sm:text-3xl" lang="en">
              {product.name}
            </h1>

            {product.reviewCount > 0 && (
              <a href="#reviews" className="mt-2 inline-flex items-center gap-1.5 text-sm text-fg-muted">
                <Star size={16} className="fill-current text-sale-500" aria-hidden="true" />
                <span className="font-semibold text-fg">{bn(product.avgRating.toFixed(1))}</span>
                <span>({bn(product.reviewCount)}টি রিভিউ)</span>
              </a>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-3xl font-bold tabular-nums text-fg" data-testid="landing-price">
                {money(shown.price)}
              </span>
              {hasWas && (
                <>
                  <span className="text-lg tabular-nums text-fg-muted line-through">{money(shown.was!)}</span>
                  <span className="rounded-[var(--chip-radius)] bg-sale-500 px-2.5 py-1 text-sm font-bold text-white">{bn(percentOffLabel(shown.price, shown.was!) ?? "")}% ছাড়</span>
                </>
              )}
            </div>
            {product.shortDescription && (
              <p className="mt-3 max-w-prose text-base leading-relaxed text-fg-muted" lang="en">
                {product.shortDescription}
              </p>
            )}

            <ul className="mt-5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface" aria-label="আমাদের প্রতিশ্রুতি">
              {promises.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex flex-col items-center gap-1 px-2 py-3 text-center">
                  <Icon size={20} className="text-fg" aria-hidden="true" />
                  <span className="text-xs font-semibold leading-tight text-fg sm:text-sm">{title}</span>
                  <span className="text-[11px] leading-tight text-fg-muted sm:text-xs">{text}</span>
                </li>
              ))}
            </ul>

            <section id="order" className="-mx-4 mt-6 scroll-mt-16 bg-surface px-4 py-6 shadow-float sm:mx-0 sm:rounded-2xl sm:p-6" aria-labelledby="order-title">
              <h2 id="order-title" className="text-xl font-bold text-fg">
                এখনই অর্ডার করুন
              </h2>
              <p className="mb-6 mt-1 text-sm leading-relaxed text-fg-muted">নাম, মোবাইল নম্বর ও ঠিকানা দিন। আমাদের প্রতিনিধি ফোন করে অর্ডারটি নিশ্চিত করবেন।</p>
              <LandingOrderForm product={product} codEnabled={settings.codEnabled} />
            </section>

            {(tel || whatsapp) && (
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                {tel && (
                  <a href={tel} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[var(--control-radius)] border border-line bg-surface text-sm font-semibold text-fg">
                    <Phone size={16} aria-hidden="true" />
                    ফোনে অর্ডার দিন
                  </a>
                )}
                {whatsapp && (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[var(--control-radius)] border border-line bg-surface text-sm font-semibold text-fg"
                  >
                    <MessageCircle size={16} aria-hidden="true" />
                    WhatsApp-এ মেসেজ দিন
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-3xl space-y-12 px-4">
          {description.trim() && (
            <details className="group rounded-xl border border-line bg-surface" open>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-lg font-bold text-fg [&::-webkit-details-marker]:hidden">
                পণ্যের বিবরণ
                <ChevronDown size={20} className="shrink-0 transition-transform duration-base group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="prose prose-sm max-w-none px-5 pb-5 text-fg" lang="en" dangerouslySetInnerHTML={{ __html: description }} />
            </details>
          )}

          <section aria-labelledby="faq-title">
            <h2 id="faq-title" className="mb-4 text-xl font-bold text-fg">
              যা জানতে চান
            </h2>
            <div className="divide-y divide-line rounded-xl border border-line bg-surface">
              {faqs.map(({ q, a }) => (
                <details key={q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-semibold text-fg [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown size={18} className="shrink-0 text-fg-muted transition-transform duration-base group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <p className="px-5 pb-4 text-sm leading-relaxed text-fg-muted">{a}</p>
                </details>
              ))}
            </div>
          </section>

          <Suspense fallback={null}>
            <LandingMoreProducts product={product} currency={settings.currency} />
          </Suspense>

          {product.reviewCount > 0 && (
            <section id="reviews" className="scroll-mt-16">
              <ProductReviews productId={product.id} productName={product.name} />
            </section>
          )}
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

      <LandingStickyCta price={money(shown.price)} was={hasWas ? money(shown.was!) : null} imageUrl={product.images[0] ? resolveImageUrl(product.images[0].url) : null} />
    </>
  );
}
