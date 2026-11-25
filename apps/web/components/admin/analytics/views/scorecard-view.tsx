"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import * as targetsApi from "@/lib/api/targets";
import { formatBookDate, formatPriceWhole } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT: Record<targetsApi.ScorecardStatus, string> = {
  good: "bg-success-500",
  watch: "bg-warning-500",
  bad: "bg-danger-500",
  neutral: "bg-ink-300",
};
const WORD: Record<targetsApi.ScorecardStatus, string> = { good: "Good", watch: "Watch", bad: "Needs attention", neutral: "" };

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthTitle(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The one-page business scorecard (docs/superpowers/plans/2026-11-18-business-reports.md, Part 2): the month so far
 * beside the same number of days before, each figure coloured by a rule written under it, and where the money is now.
 * Prints as a one-page report (the console's chrome is hidden in print).
 */
export default function ScorecardView() {
  const current = targetsApi.monthOf();
  const [month, setMonth] = useState(current);
  const q = useQuery({ queryKey: targetsApi.scorecardKey(month), queryFn: () => targetsApi.getScorecard(month), staleTime: 60_000 });

  return (
    <div className="space-y-5" data-testid="scorecard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="print:hidden">
            <ChevronLeft size={18} />
          </IconButton>
          <h2 className="min-w-[10rem] text-center text-base font-semibold text-fg">{monthTitle(month)}</h2>
          <IconButton aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= current} className="print:hidden">
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
          <Printer size={14} aria-hidden /> Print / save as PDF
        </Button>
      </div>

      {q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} variant="bordered" />
      ) : !q.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <ScorecardBody data={q.data} />
      )}
    </div>
  );
}

function ScorecardBody({ data }: { data: targetsApi.Scorecard }) {
  const fmt = (f: Pick<targetsApi.ScorecardFigure, "unit">, v: number | null) => {
    if (v === null) return "—";
    if (f.unit === "money") return formatPriceWhole(v, data.currency);
    if (f.unit === "ratio") return `${(v * 100).toFixed(1)}%`;
    if (f.unit === "times") return `${v.toFixed(2)}×`;
    return Math.round(v).toLocaleString("en-IN");
  };
  const change = (f: targetsApi.ScorecardFigure) => {
    if (f.value === null || f.previous === null || f.previous === 0) return null;
    const pct = ((f.value - f.previous) / Math.abs(f.previous)) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  };

  return (
    <>
      <p className="text-sm text-fg-muted">
        {formatBookDate(data.range.from)} – {formatBookDate(data.range.to)}, compared with {formatBookDate(data.previousRange.from)} – {formatBookDate(data.previousRange.to)} (the same number of days just before).
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {data.figures.map((f) => (
          <Card key={f.key} className="flex flex-col p-4 print:break-inside-avoid print:shadow-none" data-testid={`score-${f.key}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-fg-muted">{f.label}</span>
              {f.status !== "neutral" && (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted" title={f.rule}>
                  <span className={cn("h-2 w-2 rounded-full", DOT[f.status])} aria-hidden />
                  {/* phones keep the dot; the word stays for screen readers */}
                  <span className="max-sm:sr-only">{WORD[f.status]}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{fmt(f, f.value)}</p>
            <p className="mt-auto pt-2 text-xs text-fg-muted tabular-nums">
              {f.previous !== null ? (
                <>
                  {fmt(f, f.previous)} before{change(f) && <span className="ml-1 font-medium text-fg">{change(f)}</span>}
                </>
              ) : (
                "Nothing to compare with"
              )}
              {f.target !== null && <> · target {fmt(f, f.target)}</>}
            </p>
          </Card>
        ))}
      </div>

      {data.money && (
        <section aria-label="Money now">
          <h3 className="mb-2 text-sm font-semibold text-fg">Money now</h3>
          <div tabIndex={0} className="overflow-x-auto rounded-xl border border-line-subtle bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            <dl className="flex min-w-max divide-x divide-line-subtle">
              {[
                ["Cash, bank and wallets", data.money.cash],
                ["Owed to you", data.money.owedToYou],
                ["You owe", data.money.youOwe],
                ["Stock, at cost", data.money.stock],
              ].map(([label, value]) => (
                <div key={label as string} className="min-w-[10rem] flex-1 px-4 py-3">
                  <dt className="text-xs text-fg-muted">{label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{formatPriceWhole(value as number, data.currency)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      <p className="text-xs text-fg-subtle">
        Colours: a figure with a target follows the target (red when behind a steady pace through the month). Others compare with the same number of days before — green within 5 %, amber 5–15 % worse, red more than 15 % worse. A loss is always red; ad spend is shown, not judged.
      </p>
    </>
  );
}
