import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "-৳1,500" → ["-", "৳", "1,500"]; anything unexpected (a code such as "BDT 1,500") stays whole. */
const SYMBOL_FIRST = /^(-?)([^\d\s.,-]+)\s?([\d.,]+)$/;

/** A price as shoppers read it: tabular figures with the currency sign set a little smaller and lighter, so "৳750" reads
 * as money rather than as the letter "b" beside the number. The text content stays "৳750" (copy, search, tests). */
export function Money({ value, currency, className }: { value: string | number; currency?: string; className?: string }) {
  const text = formatPrice(value, currency);
  const parts = SYMBOL_FIRST.exec(text);
  if (!parts) return <span className={cn("ui-money", className)}>{text}</span>;
  return (
    <span className={cn("ui-money", className)}>
      {parts[1]}
      <span className="ui-money-symbol">{parts[2]}</span>
      {parts[3]}
    </span>
  );
}
