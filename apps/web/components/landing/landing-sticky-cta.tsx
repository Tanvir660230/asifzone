"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { NO_SIZE_VALUE } from "@clothing-brand/shared";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { variantDisplayPrice } from "@/lib/pricing-display";
import { cn } from "@/lib/utils";
import { colorImage, useLandingSelection } from "./landing-selection";

/**
 * The landing page's phone-width order bar: the product, its price and one button that takes the shopper to the form.
 * It appears once the shopper has scrolled past the price, hides while the form itself is on screen (it would only
 * cover it), and is not shown from 1024px, where the form sits beside the photos. It follows the shopper's choice: the
 * chosen colour's photo, the chosen variant's price, and what is chosen so far.
 */
export function LandingStickyCta({ price: pagePrice, was: pageWas, imageUrl: pageImage }: { price: string; was: string | null; imageUrl: string | null }) {
  const { product, options, size, color } = useLandingSelection();
  const variant = options.resolve(size, color);
  const chosen = variant ? variantDisplayPrice(product, variant.id) : null;
  const price = chosen ? formatPrice(chosen.price) : pagePrice;
  const was = chosen ? (chosen.was !== null && Number(chosen.was) > Number(chosen.price) ? formatPrice(chosen.was) : null) : pageWas;
  const photo = color ? colorImage(product, color) : null;
  const imageUrl = photo ? resolveImageUrl(photo.url) : pageImage;
  const picked = [color, size && size !== NO_SIZE_VALUE ? size : null].filter(Boolean).join(" · ");
  const [pastPrice, setPastPrice] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    const priceEl = document.querySelector("[data-testid='landing-price']");
    const form = document.getElementById("order");
    const observers: IntersectionObserver[] = [];
    if (priceEl) {
      const o = new IntersectionObserver(([entry]) => setPastPrice(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 0)));
      o.observe(priceEl);
      observers.push(o);
    }
    if (form) {
      const o = new IntersectionObserver(([entry]) => setFormVisible(Boolean(entry?.isIntersecting)), { threshold: 0.05 });
      o.observe(form);
      observers.push(o);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const shown = pastPrice && !formVisible;

  return (
    <div
      aria-hidden={!shown}
      className={cn(
        "fixed inset-x-0 bottom-0 z-dock border-t border-line bg-surface/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-floatLg backdrop-blur transition-transform duration-slow ease-smooth lg:hidden",
        shown ? "translate-y-0" : "translate-y-full",
      )}
      lang="bn"
      data-testid="landing-sticky-cta"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        {imageUrl && (
          <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-md bg-surface-muted">
            <Image src={imageUrl} alt="" fill sizes="40px" className="object-cover" />
          </span>
        )}
        <div className="min-w-0 leading-tight">
          <p className="text-lg font-bold tabular-nums text-fg">
            {price}
            {was && <span className="ml-1.5 text-xs font-normal text-fg-muted line-through">{was}</span>}
          </p>
          {picked && (
            <p className="truncate text-xs text-fg-muted" lang="en">
              {picked}
            </p>
          )}
        </div>
        <a
          href="#order"
          tabIndex={shown ? 0 : -1}
          className="glossy ml-auto inline-flex h-12 flex-1 items-center justify-center rounded-[var(--control-radius)] bg-accent px-5 text-base font-bold text-accent-fg active:scale-[0.98]"
        >
          অর্ডার করুন
        </a>
      </div>
    </div>
  );
}
