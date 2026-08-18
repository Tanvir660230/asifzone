"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { JourneyFunnel } from "@/components/admin/journey-funnel";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { cn } from "@/lib/utils";

type RangeOption = 7 | 30 | 90 | "all";
const RANGE_OPTIONS: RangeOption[] = [7, 30, 90, "all"];

export default function VisitorJourneyPage() {
  const [range, setRange] = useState<RangeOption>(30);
  const days = range === "all" ? undefined : range;

  const { data: funnel, isLoading } = useQuery({ queryKey: ["bi-journey-funnel", days], queryFn: () => analyticsApi.getJourneyFunnel(days) });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">Visitor Journey</h1>
          <p className="mt-1 text-sm text-ink-500">Landing page through to purchase — where visitors are lost along the way.</p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-full border border-ink-100 bg-ink-50/60 p-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-smooth",
                range === opt ? "bg-ink-900 text-cream-50 shadow-sm" : "text-ink-500 hover:text-ink-900",
              )}
            >
              {opt === "all" ? "All" : `${opt}D`}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-6 sm:p-8">
        <p className="mb-6 text-xs text-ink-400">
          Each step counts sessions that reached it independently, not a strict ordered path — a session can view a product without
          visiting a category page first, so a later step can show more sessions than the one before it.
        </p>
        {isLoading || !funnel ? (
          <div className="space-y-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-4 w-40 animate-pulse rounded bg-ink-100" />
                <div className="h-3 w-full animate-pulse rounded-full bg-ink-100" />
              </div>
            ))}
          </div>
        ) : (
          <JourneyFunnel steps={funnel.steps} bottleneckKey={funnel.bottleneckKey} />
        )}
      </Card>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Beyond the funnel</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {!funnel ? (
            <StatTileSkeleton />
          ) : (
            <StatTile
              label="Repeat Purchase Rate"
              value={`${funnel.repeatPurchase.ratePct.toFixed(1)}%`}
              icon={<Repeat size={18} />}
              tone="accent"
            />
          )}
          {funnel && (
            <Card className="flex items-center p-4 text-sm text-ink-500 sm:p-5">
              {funnel.repeatPurchase.customers.toLocaleString("en-BD")} of {funnel.repeatPurchase.totalCustomers.toLocaleString("en-BD")}{" "}
              customers have placed more than one order — lifetime, a customer-level measure, not part of the session funnel above.
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
