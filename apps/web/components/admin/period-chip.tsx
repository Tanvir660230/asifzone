"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCapabilities } from "@/hooks/use-capability";
import * as financeApi from "@/lib/api/finance";
import { cn } from "@/lib/utils";

const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

/**
 * The header's books chip (ERP UI plan, tab 21 §2): the month that just ended and where its books stand — Final (closed
 * with every month-end step done), Draft, or not closed yet — linking to Books › Month-end. Only for admins who read the
 * books; it shows nothing while loading or when it can't be read, so the header never jumps or alarms.
 */
export function PeriodChip({ className }: { className?: string }) {
  const { can, ready } = useCapabilities();
  const allowed = ready && can("finance.view");
  const q = useQuery({ queryKey: financeApi.alertKeys.monthEnd("default"), queryFn: () => financeApi.getMonthEnd(), enabled: allowed, staleTime: 5 * 60_000 });
  if (!allowed || !q.data) return null;
  const c = q.data;
  const final = c.label === "FINAL";
  const closed = c.period?.status === "CLOSED";
  const state = final ? "Final" : closed ? "Draft" : "not closed";
  return (
    <Link
      href={`/admin/finance/month-end?month=${c.month}`}
      title={final ? "Closed with every month-end step done — its figures are final" : closed ? "Closed, but month-end steps are still open" : "The month has ended; close it from Month-end"}
      className={cn(
        "hidden items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-fast ease-smooth lg:inline-flex",
        final ? "border-success-200 bg-success-50 text-success-700 hover:bg-success-100" : "border-line text-ink-700 hover:bg-ink-900/[0.04]",
        className,
      )}
      data-testid="period-chip"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", final ? "bg-success-500" : closed ? "bg-ink-400" : "bg-warning-500")} aria-hidden />
      {monthName(c.month)} · {state}
    </Link>
  );
}
