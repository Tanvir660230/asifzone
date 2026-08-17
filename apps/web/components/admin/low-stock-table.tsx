import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Package } from "lucide-react";
import type { LowStockVariant } from "@/lib/api/admin-analytics";
import { resolveImageUrl } from "@/lib/image-url";
import { cn } from "@/lib/utils";

// Matches the API's default low-stock query threshold (`getLowStockVariants(threshold = 5)`) —
// used only to size the stock bar, not to decide which variants show up here.
const STOCK_REFERENCE = 5;

function severity(stock: number): { label: string; tone: "danger" | "warning" } {
  if (stock === 0) return { label: "Out of stock", tone: "danger" };
  if (stock <= 2) return { label: "Critical", tone: "danger" };
  return { label: "Low stock", tone: "warning" };
}

const TONE_CLASS = {
  danger: { badge: "bg-danger-50 text-danger-600", bar: "bg-danger-500" },
  warning: { badge: "bg-warning-50 text-warning-600", bar: "bg-warning-500" },
} as const;

export function LowStockTable({ variants }: { variants: LowStockVariant[] }) {
  if (variants.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <CheckCircle2 size={22} className="text-success-500" />
        <p className="text-sm text-ink-500">Nothing running low right now.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-ink-100">
      {variants.map((v) => {
        const imageUrl = v.image?.url ?? v.product.images[0]?.url ?? null;
        const { label, tone } = severity(v.stock);
        const toneClass = TONE_CLASS[tone];
        const editHref = `/admin/products/${v.product.id}/edit`;
        const barPct = Math.max(6, (Math.min(v.stock, STOCK_REFERENCE) / STOCK_REFERENCE) * 100);

        return (
          <div
            key={v.id}
            className="group -mx-1 flex items-center gap-4 rounded-xl px-1 py-3.5 transition-colors duration-150 ease-smooth first:pt-0 last:pb-0 hover:bg-ink-50/60"
          >
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
              {imageUrl ? (
                <img src={resolveImageUrl(imageUrl)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {v.colorHex ? (
                    <span
                      className="h-5 w-5 rounded-full border border-ink-200"
                      style={{ backgroundColor: v.colorHex }}
                      aria-hidden
                    />
                  ) : (
                    <Package size={18} className="text-ink-300" />
                  )}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <Link href={editHref} className="block truncate text-sm font-medium text-ink-900 hover:text-ink-600">
                {v.product.name}
              </Link>
              <p className="mt-0.5 truncate text-xs text-ink-400">
                {v.size} / {v.color} · {v.sku}
              </p>
              <div className="mt-1.5 h-1.5 w-24 max-w-full overflow-hidden rounded-full bg-ink-100">
                <div className={cn("h-full rounded-full", toneClass.bar)} style={{ width: `${barPct}%` }} />
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  toneClass.badge,
                )}
              >
                {v.stock === 0 && <AlertTriangle size={11} />}
                {label}
              </span>
              <span className="text-xs text-ink-400">{v.stock} left</span>
            </div>

            <Link
              href={editHref}
              className="shrink-0 rounded-full p-2 text-ink-300 opacity-0 transition-all duration-200 ease-smooth hover:bg-ink-50 hover:text-ink-900 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Restock ${v.product.name}`}
            >
              <ArrowUpRight size={16} />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
