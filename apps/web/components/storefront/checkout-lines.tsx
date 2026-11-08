"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import { formatVariantLabel } from "@clothing-brand/shared";
import type { CartItem } from "@/store/cart";
import { formatPrice } from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

/**
 * The order summary's lines at checkout: what is being bought, as the customer recognises it (photo, size / colour),
 * with the quantity changeable right there — no trip back to the bag to buy two, or to take one out. Every amount is the
 * server quote's line (`lineAmount`), so the totals below update with the quantity. `onRemove` absent (Buy now: one
 * item) hides the bin; the − button stops at 1 and + at what is in stock.
 */
export function CheckoutLines({
  items,
  lineAmount,
  couponProductIds,
  onQuantity,
  onRemove,
}: {
  items: CartItem[];
  lineAmount: (variantId: string) => number | null;
  /** Products the applied coupon is for — those lines get a "Coupon" tag. */
  couponProductIds: string[];
  onQuantity: (variantId: string, quantity: number) => void;
  onRemove?: (variantId: string) => void;
}) {
  return (
    <ul className="divide-y divide-ink-100" aria-label="Items in this order" data-testid="checkout-lines">
      {items.map((item) => {
        const amount = lineAmount(item.variantId);
        const variant = formatVariantLabel(item.size, item.color);
        const atMax = item.quantity >= item.maxStock;
        return (
          <li key={item.variantId} className="flex gap-3 py-3 first:pt-0" data-testid="checkout-line">
            <Link href={`/product/${item.productSlug}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-ink-100">
              {item.imageUrl && <Image src={resolveImageUrl(item.imageUrl)} alt={item.productName} fill sizes="64px" className="object-cover" />}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium text-ink-900">{item.productName}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
                    {variant && <span>{variant}</span>}
                    {couponProductIds.includes(item.productId) && (
                      <span className="rounded-full bg-success-100 px-1.5 py-0.5 text-[10px] font-medium ui-caps text-success-700">Coupon</span>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-ink-900">{amount === null ? "…" : formatPrice(amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center overflow-hidden rounded-full border border-ink-200" role="group" aria-label={`Quantity of ${item.productName}`}>
                  <button
                    type="button"
                    onClick={() => onQuantity(item.variantId, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    className="flex h-9 w-9 items-center justify-center text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-200 disabled:hover:bg-transparent"
                    aria-label="One less"
                    data-testid="checkout-line-minus"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-8 text-center text-sm tabular-nums" aria-live="polite" data-testid="checkout-line-qty">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onQuantity(item.variantId, Math.min(item.maxStock, item.quantity + 1))}
                    disabled={atMax}
                    className="flex h-9 w-9 items-center justify-center text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:text-ink-200 disabled:hover:bg-transparent"
                    aria-label="One more"
                    title={atMax ? "That's all we have in stock" : undefined}
                    data-testid="checkout-line-plus"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {atMax && item.maxStock > 1 && <span className="text-[11px] text-ink-400">All we have</span>}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.variantId)}
                    className={cn("-mr-2 ml-auto rounded-full p-2 text-ink-400 transition-colors hover:bg-ink-50 hover:text-danger-600")}
                    aria-label={`Remove ${item.productName}`}
                    data-testid="checkout-line-remove"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
