"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { formatVariantLabel } from "@clothing-brand/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { useCartStore } from "@/store/cart";
import { useCartDrawerStore } from "@/store/cart-drawer";
import { useCartQuote } from "@/hooks/use-quote";
import { resolveImageUrl } from "@/lib/image-url";
import { Money } from "@/components/ui/money";

const SHOW_FOR_MS = 5000;

/** "Added to bag": a compact confirmation under the header after every add (product page, product cards, the options
 * popup), instead of opening the whole bag over the page — the shopper keeps their place and can add the next item.
 * Shows what was added, the bag's count and subtotal (server quote), and View bag / Checkout. Closes by itself after a
 * few seconds, but not while the pointer or focus is on it. */
export function AddedToBag() {
  const added = useCartDrawerStore((s) => s.added);
  const dismiss = useCartDrawerStore((s) => s.dismissAdded);
  const openBag = useCartDrawerStore((s) => s.open);
  const count = useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
  const { data: quote } = useCartQuote();
  const pathname = usePathname();
  const [paused, setPaused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // A new page is a new context: the confirmation doesn't follow the shopper there.
  useEffect(() => {
    dismiss();
  }, [pathname, dismiss]);

  useEffect(() => {
    if (!added || paused) return;
    const timer = setTimeout(dismiss, SHOW_FOR_MS);
    return () => clearTimeout(timer);
  }, [added, paused, dismiss]);

  const variant = added ? formatVariantLabel(added.size, added.color) : "";

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 top-[calc(var(--sticky-top)+0.75rem)] z-dock sm:left-auto sm:right-6 sm:w-[24rem]">
      <AnimatePresence>
        {added && (
          <motion.div
            key={added.at}
            ref={cardRef}
            role="status"
            aria-label="Added to bag"
            data-testid="added-to-bag"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(e) => {
              if (!cardRef.current?.contains(e.relatedTarget as Node)) setPaused(false);
            }}
            className="pointer-events-auto rounded-2xl bg-surface p-4 shadow-floatLg ring-1 ring-inset ring-line-subtle"
          >
            <div className="flex items-start gap-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                {added.imageUrl && <Image src={resolveImageUrl(added.imageUrl)} alt="" fill sizes="64px" className="object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-success-700">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success-600 text-cream-50">
                    <Check size={11} strokeWidth={3} aria-hidden="true" />
                  </span>
                  Added to bag
                </p>
                <p className="mt-1 line-clamp-1 text-sm font-medium text-ink-900">{added.productName}</p>
                <p className="text-xs text-ink-500">
                  {[variant, added.quantity > 1 ? `Qty ${added.quantity}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button type="button" onClick={dismiss} aria-label="Close" className="-m-1.5 rounded-full p-1.5 text-ink-500 transition-colors hover:bg-surface-muted hover:text-ink-900">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="mt-3 flex justify-between border-t border-line-subtle pt-3 text-sm text-ink-600">
              <span>
                Bag · {count} item{count === 1 ? "" : "s"}
              </span>
              <span className="font-medium tabular-nums text-ink-900">{quote ? <Money value={quote.subtotal} /> : "…"}</span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" size="md" onClick={openBag}>
                View bag
              </Button>
              <Link href="/checkout" onClick={dismiss} className={buttonVariants({ variant: "primary", size: "md" })}>
                Checkout
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
