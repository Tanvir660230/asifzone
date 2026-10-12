"use client";

import { useEffect, useState } from "react";

/**
 * The landing page's phone-width order bar: the price and one button that takes the shopper to the form. Hidden while
 * the form itself is on screen (it would only cover it) and from 1024px, where the form sits beside the photos.
 */
export function LandingStickyCta({ price, was }: { price: string; was: string | null }) {
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    const form = document.getElementById("order");
    if (!form) return;
    const observer = new IntersectionObserver(([entry]) => setFormVisible(Boolean(entry?.isIntersecting)), { threshold: 0.05 });
    observer.observe(form);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={formVisible}
      className={`fixed inset-x-0 bottom-0 z-dock border-t border-line bg-surface/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-floatLg backdrop-blur transition-transform duration-base ease-smooth lg:hidden ${
        formVisible ? "translate-y-full" : "translate-y-0"
      }`}
      lang="bn"
      data-testid="landing-sticky-cta"
    >
      <div className="mx-auto flex max-w-xl items-center gap-4">
        <div className="min-w-0 leading-tight">
          <p className="text-lg font-semibold tabular-nums text-fg">{price}</p>
          {was && <p className="text-xs tabular-nums text-fg-muted line-through">{was}</p>}
        </div>
        <a
          href="#order"
          tabIndex={formVisible ? -1 : 0}
          className="ml-auto inline-flex h-12 flex-1 items-center justify-center rounded-[var(--control-radius)] bg-ink-900 px-6 text-base font-semibold text-cream-50 active:scale-[0.98]"
        >
          এখনই অর্ডার করুন
        </a>
      </div>
    </div>
  );
}
