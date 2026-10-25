"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import * as booksApi from "@/lib/api/finance-books";
import { formatBusinessDate } from "@/lib/format";
import { addDays } from "@/lib/profit-period";
import { cn } from "@/lib/utils";
import { money } from "@/components/admin/finance/profit-chart";

/**
 * The dashboard's look at profit (docs/FINANCE_PROFIT_DASHBOARD.md): yesterday, the last 7 days and the ads behind them,
 * with the last two weeks as small bars — one tap to the Profit page for any period. Only for roles that see the books.
 */
export function ProfitGlance() {
  const to = new Date().toLocaleDateString("en-CA");
  const range = { from: addDays(to, -13), to };
  const q = useQuery({ queryKey: booksApi.booksKeys.profitDaily(range), queryFn: () => booksApi.getProfitByDay(range), staleTime: 60_000 });
  const d = q.data;
  if (q.isError) return null; // the rest of the dashboard matters more than this card; Finance shows the error
  if (!d) return <Skeleton className="h-36 w-full rounded-2xl" />;
  if (!d.booksStartedOn) return null;

  const days = d.days;
  const week = days.slice(-7);
  // The profit from selling: a stock correction (a count fix) is noted below, never shown as a day's selling loss or gain.
  const sum = (list: typeof days, k: "salesProfit" | "sales" | "ads" | "stockCorrections") => list.reduce((s, x) => s + x[k], 0);
  const yesterday = days.find((x) => x.date === addDays(d.today, -1));
  const weekProfit = sum(week, "salesProfit");
  const weekCorrections = sum(week, "stockCorrections");
  const max = Math.max(1, ...days.map((x) => Math.abs(x.salesProfit)));

  return (
    <Link href="/admin/finance/profit?view=7d" className="group block" data-testid="profit-glance">
      <Card className="grid gap-5 p-5 transition-colors duration-fast group-hover:border-line-strong sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:p-6">
        <div className="grid grid-cols-2 gap-4">
          <Figure label="Profit yesterday" value={yesterday ? yesterday.salesProfit : 0} />
          <Figure label="Last 7 days" value={weekProfit} />
          <p className="col-span-2 text-xs text-fg-muted">
            {money(sum(week, "sales"))} sales · {money(sum(week, "ads"))} on ads this week
            {Math.round(weekCorrections) !== 0 && <> · stock corrections {money(-weekCorrections)} apart</>}
          </p>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center justify-between text-[13px] font-medium text-fg-muted">
            <span>Profit, last 14 days</span>
            <span className="flex items-center gap-0.5 text-accent">Open Profit<ChevronRight className="h-4 w-4" aria-hidden /></span>
          </div>
          {/* Small bars from a centre line — green days earned, red days lost. The figures are in the label. */}
          <div className="mt-3 flex h-20 items-stretch gap-[3px]" role="img" aria-label={`Profit by day: ${days.map((x) => `${formatBusinessDate(x.date)} ${money(x.salesProfit)}`).join(", ")}`}>
            {days.map((x) => (
              <div key={x.date} className="flex flex-1 flex-col" title={`${formatBusinessDate(x.date)}: ${money(x.salesProfit)}`}>
                <div className="flex flex-1 items-end border-b border-ink-200">
                  {x.salesProfit > 0 && <span className="w-full rounded-t-[3px] bg-success-500" style={{ height: `${(x.salesProfit / max) * 100}%` }} />}
                </div>
                <div className="flex flex-1 items-start">
                  {x.salesProfit < 0 && <span className="w-full rounded-b-[3px] bg-danger-500" style={{ height: `${(-x.salesProfit / max) * 100}%` }} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  const loss = value < 0;
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-fg-muted">{label}</p>
      <p className={cn("mt-1 truncate text-[22px] font-semibold leading-tight tracking-tight tabular-nums sm:text-[26px]", loss ? "text-danger-600" : "text-fg")}>
        {loss ? `${money(-value)} loss` : money(value)}
      </p>
    </div>
  );
}
