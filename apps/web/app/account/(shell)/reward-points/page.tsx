"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Gift } from "lucide-react";
import { useCurrentCustomer } from "@/hooks/use-current-customer";
import { AccountTitle } from "@/components/account/account-ui";
import { AccountEmptyState } from "@/components/account/account-empty-state";
import { AccountPageSkeleton } from "@/components/account/account-skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { listMyPointsLedger } from "@/lib/api/customers";
import { formatCount, formatStoreDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function AccountRewardPointsPage() {
  const { data: customerData } = useCurrentCustomer();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["my-points"], queryFn: () => listMyPointsLedger() });
  const points = customerData?.customer?.rewardPoints;

  return (
    <div>
      <AccountTitle title="Points" description="You earn points on every delivered order." />

      <section aria-labelledby="points-title" className="mb-10 max-w-xl rounded-[22px] bg-surface p-6 shadow-sm ring-1 ring-inset ring-line-subtle sm:p-8">
        <p id="points-title" className="flex items-center gap-2 text-sm text-fg-muted">
          <Gift size={16} aria-hidden="true" /> Points balance
        </p>
        {points === undefined ? (
          <div className="mt-2 h-12 w-32 animate-pulse rounded-lg bg-ink-100" aria-busy="true" />
        ) : (
          <p className="mt-1 font-display text-5xl tabular-nums tracking-tight text-fg sm:text-6xl" data-testid="points-balance">
            {formatCount(points)}
          </p>
        )}
      </section>

      <h2 className="mb-3.5 px-1 text-lg font-semibold tracking-tight text-fg sm:text-xl">History</h2>
      {isLoading ? (
        <AccountPageSkeleton header={false} />
      ) : isError ? (
        <ErrorState variant="bordered" title="Your points history didn't load" onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <AccountEmptyState
          icon={Gift}
          title="No points yet"
          description="Points arrive once an order is delivered."
          action={
            <Link href="/search" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Start shopping
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line-subtle overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-inset ring-line-subtle">
          {data.items.map((entry) => {
            const earned = entry.points >= 0;
            return (
              <li key={entry.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <span
                  className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", earned ? "bg-success-50 text-success-700" : "bg-ink-100 text-ink-700")}
                  aria-hidden="true"
                >
                  {earned ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">{entry.reason}</p>
                  <p className="text-sm text-fg-muted">{formatStoreDate(entry.createdAt, { day: "numeric", month: "long", year: "numeric" })}</p>
                </div>
                <span className={cn("shrink-0 font-semibold tabular-nums", earned ? "text-success-700" : "text-fg")}>
                  <span className="sr-only">{earned ? "Earned" : "Used"}: </span>
                  {earned ? "+" : "−"}
                  {formatCount(Math.abs(entry.points))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
