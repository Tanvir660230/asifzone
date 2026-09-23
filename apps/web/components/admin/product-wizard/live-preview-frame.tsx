"use client";

import { useEffect, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import type { Product } from "@clothing-brand/shared";
import { ProductPageBody } from "@/components/storefront/product-page-body";
import { ProductGrid } from "@/components/storefront/product-grid";
import { SearchSuggestionProductContent } from "@/components/storefront/search-overlay";
import { buildAccordionItems, productPageLayout, sanitizeRichTextSpecs } from "@/lib/product-specs";
import { productSeoFields } from "@/lib/seo";
import { resolveImageUrl } from "@/lib/image-url";
import type { PreviewReadyMessage, PreviewUpdateMessage } from "@/lib/wizard/preview-protocol";

// Real, aggregate signals need a live product with real traffic — a draft has none, same as the admin's /preview/:id.
const NO_SIGNALS = { totalViews: 0, recentPurchaseCount: 0, unitsSoldLast7Days: 0, isFastSelling: false };

// In the browser this resolves to isomorphic-dompurify's browser build (plain DOMPurify on the real DOM) — the
// jsdom fallback that breaks client-side is only the Node export.
const sanitize = (html: string) => DOMPurify.sanitize(html);

/** The canonical field can be half-typed while the admin edits it — show it as a URL only when it parses. */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Clicks that would leave the preview or act on the admin's real storefront session (cart, wishlist, compare)
 * are swallowed; picking a size/colour, the gallery and quantity still work, so the admin can try the options. */
function useInertStorefrontActions() {
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      const el = (e.target as Element | null)?.closest("a[href], button");
      if (!el) return;
      const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").toLowerCase();
      if (el.tagName === "A" || /add to cart|buy now|wishlist|compare|quick (view|add)|notify me/.test(label)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);
}

function ProductPageMode({ product }: { product: Product }) {
  const clean = sanitizeRichTextSpecs(product, sanitize);
  const { showSizeGuideLink, blocks } = productPageLayout(clean);
  // The storefront's option pickers settle their initial selection once, on mount — right for a real page, whose
  // variants never change under it. Here they change as the admin types, so start them fresh (as a reload would)
  // whenever the set of sizes/colours itself changes; other edits keep the shopper-side state.
  const optionsKey = `${[...new Set(clean.variants.map((v) => v.size))].join("|")}/${[...new Set(clean.variants.map((v) => v.color))].join("|")}`;
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <ProductPageBody key={optionsKey} product={clean} urgencySignals={NO_SIGNALS} accordionItems={buildAccordionItems(clean, sanitize)} showSizeGuideLink={showSizeGuideLink} />
      </div>
      {blocks.length > 0 && (
        <div className="mx-auto max-w-7xl space-y-3 px-4 pb-12 sm:px-6 lg:px-8" data-testid="preview-blocks">
          {blocks.map((b) => (
            <div key={b.key} className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center">
              <p className="font-display text-lg text-ink-700">{b.title}</p>
              <p className="mt-1 text-xs text-ink-400">Filled in from live store data on the real page</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ListingMode({ product }: { product: Product }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <p className="mb-4 text-xs uppercase tracking-wide text-ink-400">{product.category.name} · category page</p>
      <ProductGrid products={[product]} />
    </div>
  );
}

function SearchMode({ product }: { product: Product }) {
  const image = product.images[0];
  const price = Number(product.activeFlashSale?.flashPrice ?? product.basePrice);
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-ink-100 bg-white shadow-float">
        <p className="border-b border-ink-100 px-4 py-3 text-sm text-ink-900">{product.name}</p>
        <div className="px-2 pb-2 pt-2">
          <div className="flex items-center gap-3 rounded-xl bg-ink-50 px-2.5 py-2.5">
            <SearchSuggestionProductContent product={{ id: product.id, name: product.name, slug: product.slug, price, imageUrl: image ? resolveImageUrl(image.url) : null }} highlighted />
          </div>
        </div>
      </div>
      <div>
        <p className="mb-4 text-sm text-ink-500">Search results</p>
        <ProductGrid products={[product]} />
      </div>
    </div>
  );
}

function SocialMode({ product }: { product: Product }) {
  const seo = productSeoFields(product);
  const image = seo.og.images[0];
  return (
    <div className="flex min-h-screen items-start justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-[520px] overflow-hidden rounded-lg border border-ink-200 bg-white shadow-sm" data-testid="social-card">
        <div className="aspect-[1.91/1] w-full bg-ink-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- mirrors what a social crawler fetches, not an optimized storefront image */}
          {image && <img src={image} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="space-y-0.5 bg-ink-50/60 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-ink-400">{parseUrl(seo.canonical)?.host ?? seo.canonical}</p>
          <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink-900">{seo.og.title}</p>
          {seo.og.description && <p className="line-clamp-1 text-sm text-ink-500">{seo.og.description}</p>}
        </div>
      </div>
    </div>
  );
}

function SerpMode({ product }: { product: Product }) {
  const seo = productSeoFields(product);
  const url = parseUrl(seo.canonical);
  return (
    <div className="min-h-screen bg-white px-4 py-8 font-sans sm:px-10">
      <div className="max-w-[600px]" data-testid="serp-card">
        <p className="text-sm text-[#202124]">{url?.host ?? seo.canonical}</p>
        <p className="truncate text-xs text-[#4d5156]">{url?.href ?? seo.canonical}</p>
        <p className="mt-1 line-clamp-1 text-xl text-[#1a0dab]">{seo.title}</p>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[#4d5156]">{seo.description ?? "No description — search engines will pick text from the page."}</p>
      </div>
    </div>
  );
}

/** Runs inside the wizard's preview iframe. Renders nothing of its own — the wizard (same origin, same admin session)
 * posts the in-progress product, and this renders it with the real storefront components at the iframe's real width. */
export function LivePreviewFrame() {
  const [message, setMessage] = useState<PreviewUpdateMessage | null>(null);
  useInertStorefrontActions();

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only the wizard page that embeds this frame — never another origin or window.
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      if ((e.data as PreviewUpdateMessage)?.type === "pim-preview:update") setMessage(e.data as PreviewUpdateMessage);
    }
    window.addEventListener("message", onMessage);
    const ready: PreviewReadyMessage = { type: "pim-preview:ready" };
    window.parent.postMessage(ready, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!message) return <p className="p-6 text-sm text-ink-400">Loading preview…</p>;
  const { product, mode } = message;
  return (
    <div data-testid={`preview-mode-${mode}`}>
      {mode === "product" && <ProductPageMode product={product} />}
      {mode === "listing" && <ListingMode product={product} />}
      {mode === "search" && <SearchMode product={product} />}
      {mode === "social" && <SocialMode product={product} />}
      {mode === "serp" && <SerpMode product={product} />}
    </div>
  );
}
