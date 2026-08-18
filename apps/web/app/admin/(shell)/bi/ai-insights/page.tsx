"use client";

import { useQuery } from "@tanstack/react-query";
import { Info, AlertTriangle, AlertOctagon, CheckCircle2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RankedBarList, type RankedBarListItem } from "@/components/admin/ranked-bar-list";
import { DemandForecastTable } from "@/components/admin/demand-forecast-table";
import * as analyticsApi from "@/lib/api/admin-analytics";
import * as biApi from "@/lib/api/bi";
import { cn } from "@/lib/utils";

function toBarItems<T>(rows: T[] | undefined, opts: { key: (r: T) => string; label: (r: T) => string; value: (r: T) => number; valueLabel: (r: T) => string }): RankedBarListItem[] {
  return (rows ?? []).map((r) => ({ key: opts.key(r), label: opts.label(r), value: opts.value(r), valueLabel: opts.valueLabel(r) }));
}

const SEVERITY_STYLE: Record<string, { icon: typeof AlertTriangle; classes: string }> = {
  critical: { icon: AlertOctagon, classes: "border-danger-100 bg-danger-50/60 text-danger-700" },
  warning: { icon: AlertTriangle, classes: "border-warning-100 bg-warning-50/60 text-warning-700" },
  info: { icon: CheckCircle2, classes: "border-info-100 bg-info-50/60 text-info-700" },
};

export default function AiInsightsPage() {
  const { data: insights } = useQuery({ queryKey: ["bi-ai-insights"], queryFn: biApi.getAutomatedInsights });
  const { data: bestSelling } = useQuery({ queryKey: ["bi-ai-best-selling"], queryFn: () => analyticsApi.getBestSellingPrediction(10) });
  const { data: demandForecast } = useQuery({ queryKey: ["bi-ai-demand-forecast"], queryFn: () => analyticsApi.getDemandForecast(14, 10) });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-ink-900 sm:text-3xl">AI Insights</h1>
        <p className="mt-1 text-sm text-ink-500">Automated, rule-based alerts and sales-velocity predictions surfaced from the rest of the BI system.</p>
      </div>

      {/* Insight feed */}
      <section className="space-y-3">
        {!insights ? (
          <p className="py-8 text-center text-sm text-ink-400">Checking for alerts…</p>
        ) : (
          insights.insights.map((insight) => {
            const style = SEVERITY_STYLE[insight.severity] ?? SEVERITY_STYLE.info!;
            const Icon = style.icon;
            return (
              <Card key={insight.id} className={cn("flex items-start gap-3 p-4", style.classes)}>
                <Icon size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{insight.title}</p>
                  <p className="mt-0.5 text-sm opacity-90">{insight.detail}</p>
                </div>
              </Card>
            );
          })
        )}
      </section>

      {/* Predictions */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Likely best sellers (7d velocity vs. prior 7d)</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBarList
              items={toBarItems(bestSelling?.products, { key: (p) => p.name, label: (p) => p.name, value: (p) => p.recentUnits, valueLabel: (p) => `${p.recentUnits} units (${p.growthPct >= 0 ? "+" : ""}${p.growthPct.toFixed(0)}%)` })}
              emptyLabel="Not enough recent sales to project a trend yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Restock prediction (stockout risk)</CardTitle>
          </CardHeader>
          <CardContent>{demandForecast && <DemandForecastTable variants={demandForecast.variants} />}</CardContent>
        </Card>
      </section>

      <Card className="flex items-start gap-3 border-info-100 bg-info-50/60 p-4">
        <Sparkles size={18} className="mt-0.5 shrink-0 text-info-600" />
        <p className="text-sm text-info-700">
          <Info size={14} className="mr-1 inline" />
          These are deterministic, threshold-based checks against the store&apos;s own metrics — not a trained machine-learning model.
          Predictions are simple trend/velocity projections, useful as a heads-up, not a guarantee.
        </p>
      </Card>
    </div>
  );
}
