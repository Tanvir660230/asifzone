import type { Product } from "@clothing-brand/shared";
import { percentOffLabel, productDisplayPrice } from "@/lib/pricing-display";

export function PromoBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-sale-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
      {children}
    </span>
  );
}

const NEW_ARRIVAL_WINDOW_DAYS = 21;
const LIMITED_STOCK_THRESHOLD = 5;

/** One priority-ranked promo label per card, so badges never stack/clutter: a live discount beats
 * "New Arrival" beats a low-stock nudge. Sold-out is handled separately by the caller — it's an
 * availability signal, not a promotion. */
export function getProductBadge(product: Product, totalStock: number): string | null {
  // The label compares two SERVER-resolved numbers (the price now vs. the struck-through price) — no price is computed.
  const shown = productDisplayPrice(product);
  if (shown.flash || shown.was !== null) {
    const pct = percentOffLabel(shown.price, shown.was);
    return pct && pct > 0 ? `${pct}% Off` : "Sale";
  }

  const ageDays = (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= NEW_ARRIVAL_WINDOW_DAYS) return "New Arrival";

  if (totalStock > 0 && totalStock <= LIMITED_STOCK_THRESHOLD) return "Limited Item";

  return null;
}
