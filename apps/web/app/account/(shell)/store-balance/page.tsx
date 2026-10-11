"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import type { StoreCreditEntryType } from "@clothing-brand/shared";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { AccountTitle } from "@/components/account/account-ui";
import { Button } from "@/components/ui/button";
import { getMyStoreCredit } from "@/lib/api/customers";
import { formatPrice, formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Customer-facing words for each ledger entry type (docs/ORDER_ADJUSTMENTS.md §4). */
const TYPE_LABEL: Record<StoreCreditEntryType, string> = {
  CANCELLATION: "Cancelled order — payment kept as balance",
  ORDER_MODIFICATION: "Order change",
  RETURN: "Returned items",
  EXCHANGE: "Exchange price difference",
  REFUND_TO_CREDIT: "Refund added as balance",
  ORDER_PAYMENT: "Used on an order",
  ORDER_PAYMENT_RELEASED: "Returned from an unfinished online payment",
};

/** Store Balance (docs/ORDER_ADJUSTMENTS.md §18): the balance and every movement behind it, exactly as the store's ledger
 * records them — the page never adds anything up itself. Store-use only: spend it at checkout. */
export default function StoreBalancePage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["my-store-credit"], queryFn: getMyStoreCredit });
  const summary = data?.storeCredit;

  return (
    <div>
      <AccountTitle title="Store balance" description="Money from cancelled orders, order changes and returns. Use it on any order at checkout." />

      <section
        className="relative mb-10 max-w-xl overflow-hidden rounded-[22px] bg-surface-inverse p-6 text-cream-50 shadow-floatLg ring-1 ring-inset ring-white/[0.08] sm:p-8"
        aria-labelledby="balance-title"
        data-testid="store-balance-card"
      >
        <p id="balance-title" className="flex items-center gap-2 text-sm text-ink-400">
          <Wallet size={16} aria-hidden="true" /> Available balance
        </p>
        {isLoading ? (
          <div className="mt-2 h-12 w-44 animate-pulse rounded-lg bg-white/10" aria-busy="true" aria-label="Loading balance" />
        ) : isError ? (
          <div className="mt-2 flex items-center gap-3">
            <p className="text-sm text-cream-50">Your balance didn&apos;t load.</p>
            <Button variant="glass" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="mt-1 font-display text-5xl tabular-nums tracking-tight sm:text-6xl" data-testid="store-balance-amount">
            {formatPrice(summary?.balance ?? 0)}
          </p>
        )}
        <p className="mt-4 text-sm text-ink-400">For use in this store only, not as cash. It never expires.</p>
      </section>

      {summary && summary.entries.length === 0 ? (
        <AccountEmptyState
          icon={Wallet}
          title="No balance history yet"
          description="When an order is cancelled after payment, changed to a lower total, or items are returned, the amount appears here."
          action={
            <Link href="/">
              <Button size="sm">Continue shopping</Button>
            </Link>
          }
        />
      ) : (
        summary && (
          <section aria-labelledby="history-title">
            <h2 id="history-title" className="mb-3.5 px-1 text-lg font-semibold tracking-tight text-fg sm:text-xl">
              History
            </h2>
            <ul className="divide-y divide-line-subtle overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-inset ring-line-subtle" data-testid="store-balance-history">
              {summary.entries.map((e) => {
                const credit = e.amount > 0;
                return (
                  <li key={e.id} className="flex items-start gap-4 px-4 py-4 sm:px-5">
                    <span
                      className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full", credit ? "bg-success-50 text-success-700" : "bg-ink-100 text-ink-700")}
                      aria-hidden="true"
                    >
                      {credit ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink-900">{TYPE_LABEL[e.type]}</p>
                      <p className="text-xs text-ink-500">
                        <time dateTime={e.createdAt}>{formatStoreDate(e.createdAt)}</time>
                        {e.orderNumber && (
                          <>
                            {" · "}
                            {e.orderId ? (
                              <Link href={`/account/orders/${e.orderId}`} className="underline underline-offset-2 hover:text-ink-800">
                                Order {e.orderNumber}
                              </Link>
                            ) : (
                              `Order ${e.orderNumber}`
                            )}
                          </>
                        )}
                      </p>
                    </div>
                    <p className={cn("shrink-0 font-semibold tabular-nums", credit ? "text-success-700" : "text-ink-900")}>
                      <span className="sr-only">{credit ? "Added" : "Used"}: </span>
                      {credit ? "+" : "−"}
                      {formatPrice(Math.abs(e.amount))}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
