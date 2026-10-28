import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { cn } from "@/lib/utils";

/** Where a cost figure comes from (apps/api domain/finance/cost-resolver.ts, blueprint P-1). */
export type CostBasis = "BOOK" | "PROVISIONAL" | "ESTIMATED" | "CATALOG" | "MISSING";

const LABEL: Partial<Record<CostBasis, string>> = { PROVISIONAL: "Provisional", ESTIMATED: "Estimated" };

/** A cost or a value built on one: the amount, a small "Estimated" / "Provisional" chip when it is not a book figure, and
 * "Cost missing" instead of a number when no cost exists — never a blank and never 0 (ERP UI plan, tab 21 §3). */
export function CostAmount({ value, basis, currency, className }: { value: number | string | null; basis?: CostBasis | string; currency?: string; className?: string }) {
  if (value === null || basis === "MISSING") {
    return (
      <Badge className={cn("bg-[var(--data-missing-bg)] text-[var(--data-missing-fg)]", className)}>
        Cost missing
      </Badge>
    );
  }
  const label = basis ? LABEL[basis as CostBasis] : undefined;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Money value={value} currency={currency} />
      {label && (
        <Badge className="bg-[var(--data-estimate-bg)] px-1.5 py-0 text-[11px] text-[var(--data-estimate-fg)]" title={label === "Estimated" ? "Not from the books — an estimate from the catalog cost" : "From the recipe until the stock is valued"}>
          {label}
        </Badge>
      )}
    </span>
  );
}
