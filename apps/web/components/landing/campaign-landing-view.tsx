import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import DOMPurify from "isomorphic-dompurify";
import { BadgeCheck, Banknote, MessageCircle, Package, Phone, RotateCcw, Ruler, ShieldCheck, Sparkles, Star, Truck, type LucideIcon } from "lucide-react";
import {
  landingVariants,
  storePolicy,
  type LandingBackground,
  type LandingIcon,
  type LandingSection,
  type Product,
  type PublicLandingPage,
  type StoreSettings,
} from "@clothing-brand/shared";
import { ProductReviews } from "@/components/storefront/product-reviews";
import { TrackProductView } from "@/components/storefront/track-product-view";
import { getActiveSocialLinksSafe, getProductBySlug, getSiteSettings } from "@/lib/api/storefront";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { bn, bnRange, landingPromises, standardLandingFaqs } from "@/lib/landing-content";
import { productDisplayPrice } from "@/lib/pricing-display";
import { buildOpenGraph, productSeoFields, storeTitle } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { LandingColorShowcase, LandingCountdown, LandingLivePrice } from "./campaign-client";
import { LandingFaqList, LandingFooter, LandingHeader, telHref } from "./landing-chrome";
import { LandingSelectionGallery } from "./landing-gallery";
import { LandingMoreProducts } from "./landing-more-products";
import { LandingOrderForm } from "./landing-order-form";
import { LandingSelectionProvider } from "./landing-selection";
import { LandingStickyCta } from "./landing-sticky-cta";

/* A campaign landing page (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §2): the admin's sections in the admin's order, around
   the same gallery, order form, tracking and checkout as a product's automatic landing page. Every option maps to a
   theme token, so a page looks right in every brand. Prices and stock come live from the product. */

/** The product as this page sells it: only the variants it offers, and none of the photos that belong only to the
 * others (otherwise they would show as "shared" photos for every colour). */
export function sellOnPage(product: Product, variantIds: string[]): Product {
  const variants = landingVariants(product.variants, variantIds);
  if (variants.length === product.variants.length) return product;
  const own = (v: Product["variants"][number]) => [...(v.images ?? []).map((i) => i.imageId), ...(v.imageId ? [v.imageId] : [])];
  const kept = new Set(variants.flatMap(own));
  const dropped = new Set(product.variants.filter((v) => !variants.includes(v)).flatMap(own).filter((id) => !kept.has(id)));
  return { ...product, variants, images: product.images.filter((i) => !dropped.has(i.id)) };
}

export async function loadCampaignProduct(page: PublicLandingPage): Promise<Product | null> {
  try {
    return sellOnPage((await getProductBySlug(page.productSlug)).product, page.content.variantIds);
  } catch {
    return null;
  }
}

export function campaignMetadata(page: PublicLandingPage, product: Product, storeName: string): Metadata {
  const seo = productSeoFields(product);
  const title = page.content.seoTitle || seo.title;
  const description = page.content.seoDescription || seo.description;
  const images = page.content.ogImageUrl ? [resolveImageUrl(page.content.ogImageUrl)] : seo.og.images;
  return {
    title: storeTitle(title, storeName),
    description,
    // A campaign page is for ads: search engines index the product page instead.
    alternates: { canonical: seo.canonical },
    robots: { index: false, follow: true },
    ...buildOpenGraph({ title, description, url: seo.canonical, siteName: storeName, images }),
  };
}

const ICONS: Record<LandingIcon, LucideIcon> = {
  truck: Truck,
  banknote: Banknote,
  rotate: RotateCcw,
  shield: ShieldCheck,
  star: Star,
  phone: Phone,
  sparkles: Sparkles,
  ruler: Ruler,
  package: Package,
  badge: BadgeCheck,
};

const BACKGROUNDS: Record<LandingBackground, string> = { canvas: "bg-canvas", surface: "bg-surface", muted: "bg-surface-muted" };

export async function CampaignLandingView({ page, product, previewBanner }: { page: PublicLandingPage; product: Product; previewBanner?: ReactNode }) {
  const [{ settings }, { links }] = await Promise.all([getSiteSettings(), getActiveSocialLinksSafe()]);
  const { content } = page;
  const money = (value: string | number) => formatPrice(value, settings.currency);
  const shown = productDisplayPrice(product);
  const hasWas = shown.was !== null && Number(shown.was) > Number(shown.price);
  const tel = telHref(settings.contactPhone);
  const whatsapp = links.find((l) => l.platform === "WHATSAPP" && l.isActive)?.url ?? null;
  const heading = content.design.headingFont === "sans" ? "font-sans" : "font-display";
  const sections = content.sections.filter((s) => s.enabled && visible(s));

  const ctx: SectionContext = { product, settings, money, tel, whatsapp, heading, hasHero: sections.some((s) => s.type === "hero") };
  const blocks: ReactNode[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    // Gallery & price followed straight by the order form: from 1024px the form sits beside the photos, as on the
    // product's own landing page, instead of below them.
    const next = sections[i + 1];
    if (s.type === "product" && next?.type === "order") {
      blocks.push(<ProductSection key={s.id} section={s} ctx={ctx} order={next} />);
      i++;
      continue;
    }
    blocks.push(<SectionBlock key={s.id} section={s} ctx={ctx} />);
  }

  return (
    <LandingSelectionProvider product={product} defaultColor={content.defaultColor} defaultSize={content.defaultSize}>
      <TrackProductView productId={product.id} productName={product.name} categoryId={product.categoryId} price={Number(shown.price)} />
      {previewBanner}
      <LandingHeader settings={settings} tel={content.design.headerCall ? tel : null} />
      <main id="main-content" className={cn("flex-1", content.design.stickyCta ? "pb-28 lg:pb-0" : "")} lang="bn" data-testid="campaign-landing">
        {blocks}
      </main>
      <LandingFooter storeName={settings.storeName} />
      {content.design.stickyCta && (
        <LandingStickyCta price={money(shown.price)} was={hasWas ? money(shown.was!) : null} imageUrl={product.images[0] ? resolveImageUrl(product.images[0].url) : null} />
      )}
    </LandingSelectionProvider>
  );
}

/** An offer whose countdown has ended hides itself. */
function visible(s: LandingSection) {
  return !(s.type === "offer" && s.endsAt && new Date(s.endsAt).getTime() <= Date.now());
}

interface SectionContext {
  product: Product;
  settings: StoreSettings;
  money: (v: string | number) => string;
  tel: string | null;
  whatsapp: string | null;
  heading: string;
  /** A hero holds the page's h1, so the product name steps down to h2. */
  hasHero: boolean;
}

function Band({ section, children, className, id, label }: { section: LandingSection; children: ReactNode; className?: string; id?: string; label?: string }) {
  return (
    <section id={id ?? `s-${section.id}`} aria-label={label} className={cn("scroll-mt-16 py-10 sm:py-14", BACKGROUNDS[section.background], className)} data-section={section.type}>
      {children}
    </section>
  );
}

function Title({ children, ctx, className }: { children: ReactNode; ctx: SectionContext; className?: string }) {
  return <h2 className={cn(ctx.heading, "text-2xl font-bold leading-tight text-fg sm:text-3xl", className)}>{children}</h2>;
}

function SectionBlock({ section: s, ctx }: { section: LandingSection; ctx: SectionContext }) {
  const { product, settings } = ctx;
  switch (s.type) {
    case "hero": {
      const src = s.imageUrl ? resolveImageUrl(s.imageUrl) : product.images[0] ? resolveImageUrl(product.images[0].url) : null;
      const center = s.align === "center";
      return (
        <Band section={s} className="py-0 sm:py-0">
          <div className={cn("mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:py-12 lg:items-center lg:gap-12", src && "lg:grid-cols-2", center && !src && "text-center")}>
            <div className={cn(center && "text-center lg:text-left")}>
              {s.eyebrow && <p className="text-sm font-semibold uppercase tracking-wide text-accent">{s.eyebrow}</p>}
              <h1 className={cn(ctx.heading, "mt-2 text-3xl font-bold leading-tight text-fg sm:text-4xl lg:text-5xl")}>{s.headline}</h1>
              {s.subheadline && <p className="mt-4 max-w-prose text-base leading-relaxed text-fg-muted sm:text-lg">{s.subheadline}</p>}
              <a
                href="#order"
                className="glossy mt-6 inline-flex h-12 items-center justify-center rounded-[var(--control-radius)] bg-accent px-8 text-base font-bold text-accent-fg shadow-float transition-[transform,background-color] duration-base ease-smooth hover:bg-accent-hover active:scale-[0.98]"
              >
                {s.ctaText || "এখনই অর্ডার করুন"}
              </a>
            </div>
            {src && (
              <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface-muted sm:aspect-[5/4]">
                <Image src={src} alt={product.name} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
              </div>
            )}
          </div>
        </Band>
      );
    }
    case "product":
      return <ProductSection section={s} ctx={ctx} />;
    case "colors":
      return (
        <Band section={s}>
          <div className="mx-auto max-w-6xl px-4">
            <Title ctx={ctx}>{s.title}</Title>
            {s.subtitle && <p className="mt-2 text-base text-fg-muted">{s.subtitle}</p>}
            <div className="mt-6">
              <LandingColorShowcase />
            </div>
          </div>
        </Band>
      );
    case "features":
      return (
        <Band section={s}>
          <div className="mx-auto max-w-5xl px-4">
            <Title ctx={ctx}>{s.title}</Title>
            <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {s.items.map((item, i) => {
                const Icon = item.icon ? ICONS[item.icon] : null;
                return (
                  <li key={i} className="flex gap-4">
                    {Icon && (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg">
                        <Icon size={20} aria-hidden="true" />
                      </span>
                    )}
                    <span>
                      <span className="block text-base font-semibold text-fg">{item.title}</span>
                      {item.text && <span className="mt-1 block text-sm leading-relaxed text-fg-muted">{item.text}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Band>
      );
    case "specs":
      return (
        <Band section={s}>
          <div className="mx-auto max-w-3xl px-4">
            <Title ctx={ctx}>{s.title}</Title>
            <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
              {s.rows.map((row, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-5 py-3.5 text-sm">
                  <dt className="text-fg-muted">{row.label}</dt>
                  <dd className="font-medium text-fg">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Band>
      );
    case "offer":
      return (
        <Band section={s}>
          <div className="mx-auto max-w-3xl px-4 text-center">
            {s.badge && <span className="inline-block rounded-[var(--chip-radius)] bg-sale-500 px-3 py-1 text-sm font-bold text-white">{s.badge}</span>}
            <Title ctx={ctx} className="mt-3">
              {s.title}
            </Title>
            {s.text && <p className="mx-auto mt-3 max-w-prose text-base leading-relaxed text-fg-muted">{s.text}</p>}
            {s.endsAt && <LandingCountdown endsAt={s.endsAt} />}
          </div>
        </Band>
      );
    case "description": {
      const html = DOMPurify.sanitize(product.description ?? "");
      if (!html.trim()) return null;
      return (
        <Band section={s}>
          <div className="mx-auto max-w-3xl px-4">
            <Title ctx={ctx}>{s.title}</Title>
            <div className="prose prose-sm mt-5 max-w-none text-fg" lang="en" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </Band>
      );
    }
    case "reviews":
      if (product.reviewCount === 0) return null;
      return (
        <Band section={s} id="reviews">
          <div className="mx-auto max-w-3xl px-4">
            <ProductReviews productId={product.id} productName={product.name} productType={product.productType} />
          </div>
        </Band>
      );
    case "delivery": {
      const policy = storePolicy(settings);
      const { insideDhaka, outsideDhaka } = policy.deliveryDays;
      const rows = [
        { label: "ঢাকার ভেতরে", value: `${ctx.money(settings.shippingFeeDhaka)} · ${bnRange(insideDhaka)} দিন` },
        { label: "ঢাকার বাইরে", value: `${ctx.money(settings.shippingFeeOutsideDhaka)} · ${bnRange(outsideDhaka)} দিন` },
        { label: "পেমেন্ট", value: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে দাম দিন" },
        ...(policy.returns ? [{ label: "রিটার্ন", value: `ডেলিভারির ${bn(policy.returns.days)} দিনের মধ্যে` }] : []),
      ];
      return (
        <Band section={s}>
          <div className="mx-auto max-w-3xl px-4">
            <Title ctx={ctx}>{s.title}</Title>
            <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
              {rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 px-5 py-3.5 text-sm">
                  <dt className="text-fg-muted">{row.label}</dt>
                  <dd className="font-medium tabular-nums text-fg">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Band>
      );
    }
    case "faq": {
      const faqs = [...s.items, ...(s.includeStandard ? standardLandingFaqs(settings, storePolicy(settings), ctx.money) : [])];
      if (!faqs.length) return null;
      return (
        <Band section={s}>
          <div className="mx-auto max-w-3xl px-4">
            <Title ctx={ctx} className="mb-5">
              {s.title}
            </Title>
            <LandingFaqList faqs={faqs} />
          </div>
        </Band>
      );
    }
    case "trust":
      return (
        <Band section={s} className="py-6 sm:py-8">
          <ul className="mx-auto flex max-w-5xl flex-wrap justify-center gap-x-8 gap-y-4 px-4">
            {s.items.map((item, i) => {
              const Icon = ICONS[item.icon ?? "badge"];
              return (
                <li key={i} className="flex items-center gap-2.5 text-sm">
                  <Icon size={20} className="shrink-0 text-fg" aria-hidden="true" />
                  <span>
                    <span className="block font-semibold text-fg">{item.title}</span>
                    {item.text && <span className="block text-xs text-fg-muted">{item.text}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Band>
      );
    case "order":
      return (
        <Band section={s} id="order" label={s.title}>
          <div className="mx-auto max-w-xl px-4">
            <OrderBlock section={s} ctx={ctx} />
          </div>
        </Band>
      );
    case "moreProducts":
      return (
        <Band section={s}>
          <div className="mx-auto max-w-3xl px-4">
            <Suspense fallback={null}>
              <LandingMoreProducts product={product} currency={settings.currency} />
            </Suspense>
          </div>
        </Band>
      );
  }
}

type OrderSection = Extract<LandingSection, { type: "order" }>;

function OrderBlock({ section, ctx }: { section: OrderSection; ctx: SectionContext }) {
  return (
    <>
      <h2 id="order-title" className={cn(ctx.heading, "text-xl font-bold text-fg sm:text-2xl")}>
        {section.title}
      </h2>
      {section.subtitle && <p className="mb-6 mt-1 text-sm leading-relaxed text-fg-muted">{section.subtitle}</p>}
      <div className={section.subtitle ? "" : "mt-6"}>
        <LandingOrderForm codEnabled={ctx.settings.codEnabled} ctaText={section.ctaText} />
      </div>
      {(ctx.tel || ctx.whatsapp) && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {ctx.tel && (
            <a href={ctx.tel} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[var(--control-radius)] border border-line bg-surface text-sm font-semibold text-fg">
              <Phone size={16} aria-hidden="true" />
              ফোনে অর্ডার দিন
            </a>
          )}
          {ctx.whatsapp && (
            <a
              href={ctx.whatsapp}
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
    </>
  );
}

function ProductSection({ section: s, ctx, order }: { section: Extract<LandingSection, { type: "product" }>; ctx: SectionContext; order?: OrderSection }) {
  const { product, settings } = ctx;
  const promises = landingPromises(storePolicy(settings));
  const Name = ctx.hasHero ? "h2" : "h1";
  return (
    <Band section={s} className="pt-0 sm:pt-0 lg:pt-8">
      <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12 lg:px-4">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <LandingSelectionGallery />
        </div>
        <div className="px-4 pt-5 lg:px-0 lg:pt-0">
          <Name className={cn(ctx.heading, "text-2xl font-semibold leading-tight text-fg sm:text-3xl")} lang="en">
            {product.name}
          </Name>
          {s.showRating && product.reviewCount > 0 && (
            <a href="#reviews" className="mt-2 inline-flex items-center gap-1.5 text-sm text-fg-muted">
              <Star size={16} className="fill-current text-sale-500" aria-hidden="true" />
              <span className="font-semibold text-fg">{bn(product.avgRating.toFixed(1))}</span>
              <span>({bn(product.reviewCount)}টি রিভিউ)</span>
            </a>
          )}
          <LandingLivePrice />
          {s.showShortDescription && product.shortDescription && (
            <p className="mt-3 max-w-prose text-base leading-relaxed text-fg-muted" lang="en">
              {product.shortDescription}
            </p>
          )}
          {s.showPromises && (
            <ul className="mt-5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface" aria-label="আমাদের প্রতিশ্রুতি">
              {promises.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex flex-col items-center gap-1 px-2 py-3 text-center">
                  <Icon size={20} className="text-fg" aria-hidden="true" />
                  <span className="text-xs font-semibold leading-tight text-fg sm:text-sm">{title}</span>
                  <span className="text-[11px] leading-tight text-fg-muted sm:text-xs">{text}</span>
                </li>
              ))}
            </ul>
          )}
          {order ? (
            <section id="order" className={cn("-mx-4 mt-6 scroll-mt-16 px-4 py-6 shadow-float sm:mx-0 sm:rounded-2xl sm:p-6", BACKGROUNDS[order.background === "canvas" ? "surface" : order.background])} aria-labelledby="order-title">
              <OrderBlock section={order} ctx={ctx} />
            </section>
          ) : (
            <a
              href="#order"
              className="glossy mt-6 flex h-14 w-full items-center justify-center rounded-[var(--control-radius)] bg-accent text-lg font-bold text-accent-fg shadow-float transition-[transform,background-color] duration-base ease-smooth hover:bg-accent-hover active:scale-[0.98]"
            >
              এখনই অর্ডার করুন
            </a>
          )}
        </div>
      </div>
    </Band>
  );
}
