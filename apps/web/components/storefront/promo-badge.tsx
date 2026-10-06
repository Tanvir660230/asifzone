import type { Product } from "@clothing-brand/shared";
import { percentOffLabel, productDisplayPrice } from "@/lib/pricing-display";

export type BadgeTone = "sale" | "note";

/** `sale` is the brand's one promotional accent (a live discount); `note` is everything else ("New Arrival", "Limited
 * Item"), whose colors are theme tokens — the base design shows them in the sale accent too, a theme may quiet them. */
const TONE_CLASS: Record<BadgeTone, string> = {
  sale: "bg-sale-500 text-white",
  note: "bg-[color:var(--badge-note-bg)] text-[color:var(--badge-note-fg)]",
};

export function PromoBadge({ tone = "sale", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ui-caps ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const NEW_ARRIVAL_WINDOW_DAYS = 21;
const LIMITED_STOCK_THRESHOLD = 5;

/** One priority-ranked promo label per card, so badges never stack/clutter: a live discount beats
 * "New Arrival" beats a low-stock nudge. Sold-out is handled separately by the caller — it's an
 * availability signal, not a promotion. */
export function getProductBadge(product: Product, totalStock: number): { label: string; tone: BadgeTone } | null {
  // The label compares two SERVER-resolved numbers (the price now vs. the struck-through price) — no price is computed.
  const shown = productDisplayPrice(product);
  if (shown.flash || shown.was !== null) {
    const pct = percentOffLabel(shown.price, shown.was);
    return { label: pct && pct > 0 ? `${pct}% Off` : "Sale", tone: "sale" };
  }

  const ageDays = (Date.now() - new Date(product.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= NEW_ARRIVAL_WINDOW_DAYS) return { label: "New Arrival", tone: "note" };

  if (totalStock > 0 && totalStock <= LIMITED_STOCK_THRESHOLD) return { label: "Limited Item", tone: "note" };

  return null;
}
