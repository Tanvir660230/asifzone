"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Info, OctagonAlert, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import * as biApi from "@/lib/api/bi";
import type { AutomatedInsight } from "@/lib/api/bi";
import { cn } from "@/lib/utils";

const SEVERITY_RANK: Record<AutomatedInsight["severity"], number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_STYLE: Record<AutomatedInsight["severity"], { icon: typeof Info; tone: string }> = {
  critical: { icon: OctagonAlert, tone: "bg-danger-50 text-danger-600" },
  warning: { icon: AlertTriangle, tone: "bg-warning-50 text-warning-600" },
  info: { icon: Info, tone: "bg-info-50 text-info-600" },
};

const SHOWN = 3;

/** The BI engine's top rule-based insights, most severe first — a pointer into BI rather than a copy of it. Renders
 * nothing when there's nothing to say, so a quiet store doesn't get an empty box. */
export function InsightsStrip({ enabled = true }: { enabled?: boolean }) {
  const { data } = useQuery({ queryKey: ["bi-ai-insights"], queryFn: biApi.getAutomatedInsights, enabled, staleTime: 5 * 60_000 });

  const insights = [...(data?.insights ?? [])].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  if (insights.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-4 sm:px-6">
        <h2 className="flex items-center gap-2 font-display text-lg tracking-tight text-ink-900">
          <Sparkles size={17} className="text-brass-500" />
          Insights
        </h2>
        <Link
          href="/admin/bi/ai-insights"
          className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-500 transition-colors duration-150 ease-smooth hover:text-ink-900"
        >
          {insights.length > SHOWN ? `All ${insights.length}` : "Business Intelligence"} <ArrowUpRight size={14} />
        </Link>
      </div>
      <ul className="grid grid-cols-1 gap-px bg-line-subtle md:grid-cols-3">
        {insights.slice(0, SHOWN).map((insight) => {
          const style = SEVERITY_STYLE[insight.severity];
          const Icon = style.icon;
          return (
            <li key={insight.id} className="flex gap-3 bg-surface px-5 py-4 sm:px-6">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", style.tone)}>
                <Icon size={15} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug text-ink-900">{insight.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-500">{insight.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
