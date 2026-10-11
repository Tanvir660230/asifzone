import { CheckCircle2, CreditCard, Truck, Wallet, type LucideIcon } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The money consequence of an order adjustment, in one unmistakable line: always an icon AND words, never colour alone
 * (docs/ORDER_ADJUSTMENTS.md §5 keeps Payment, Refund and Store Credit distinct — so does the wording here). The amount is
 * the server's; this component never computes one.
 */
export type MoneyOutcomeKind =
  /** Something must be paid online before the change takes effect. */
  | "pay"
  /** More is due and will be collected on delivery (cash on delivery). */
  | "collect"
  /** Goes to the customer's Store Balance. */
  | "credit"
  /** Owed back as a refund (staff pays it out). */
  | "refund"
  /** No money moves. */
  | "none";

const STYLE: Record<MoneyOutcomeKind, { icon: LucideIcon; box: string; iconClass: string }> = {
  pay: { icon: CreditCard, box: "border-warning-200 bg-warning-50", iconClass: "text-warning-700" },
  collect: { icon: Truck, box: "border-warning-200 bg-warning-50", iconClass: "text-warning-700" },
  credit: { icon: Wallet, box: "border-success-200 bg-success-50", iconClass: "text-success-700" },
  refund: { icon: Wallet, box: "border-info-200 bg-info-50", iconClass: "text-info-700" },
  none: { icon: CheckCircle2, box: "border-line bg-surface-muted", iconClass: "text-ink-600" },
};

export function moneyOutcomeText(kind: MoneyOutcomeKind, amount: number, audience: "customer" | "staff"): { title: string; detail: string } {
  const amt = formatPrice(amount);
  const you = audience === "customer";
  switch (kind) {
    case "pay":
      return {
        title: `${amt} to pay`,
        detail: you ? "Your change takes effect once this payment is completed." : "The change takes effect only once the customer has paid this difference.",
      };
    case "collect":
      return { title: `${amt} due`, detail: you ? "Paid on delivery." : "Collected by the courier on delivery." };
    case "credit":
      return {
        title: `${amt} will be added to ${you ? "your" : "the customer's"} Store Balance`,
        detail: you ? "You can use it on any future order." : "Store credit for future orders — not a cash refund.",
      };
    case "refund":
      return { title: `${amt} refund owed`, detail: "Recorded as owed; staff pay it out and mark it paid." };
    case "none":
      return { title: "No payment or credit needed", detail: you ? "Your total stays the same." : "The total is unchanged — no money moves." };
  }
}

export function MoneyOutcome({
  kind,
  amount,
  audience,
  className,
  testId,
  extra,
}: {
  kind: MoneyOutcomeKind;
  amount: number;
  audience: "customer" | "staff";
  className?: string;
  testId?: string;
  /** One more server-derived fact to state under the outcome (e.g. "৳599 more than before"). */
  extra?: string | null;
}) {
  const s = STYLE[kind];
  const t = moneyOutcomeText(kind, amount, audience);
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3.5", s.box, className)} data-testid={testId} data-outcome={kind} role="status">
      <s.icon size={20} className={cn("mt-0.5 shrink-0", s.iconClass)} aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-ink-900">{t.title}</p>
        <p className="text-sm text-ink-600">{t.detail}</p>
        {extra && <p className="text-sm text-ink-600">{extra}</p>}
      </div>
    </div>
  );
}
