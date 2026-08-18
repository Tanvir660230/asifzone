import { AlertTriangle, ArrowDown, ArrowUpRight } from "lucide-react";
import type { JourneyFunnelStep } from "@/lib/api/admin-analytics";
import { cn } from "@/lib/utils";

interface JourneyFunnelProps {
  steps: JourneyFunnelStep[];
  bottleneckKey: string | null;
}

/** Vertical funnel visualization — each bar's width is % of the Landing baseline (always 0-100%,
 * so it's always sensible), with the hop-to-hop change shown alongside it. Steps are counted
 * independently ("did this session reach step X"), not as strict subsets of one another, so a
 * later step can have *more* sessions than the one before it (e.g. a direct product-page link
 * skips Category entirely) — that's shown as a neutral "direct entries" note, never as a fake
 * drop-off, since it isn't one. */
export function JourneyFunnel({ steps, bottleneckKey }: JourneyFunnelProps) {
  const landing = steps[0]?.sessions ?? 0;

  if (landing === 0) {
    return <p className="py-8 text-center text-sm text-ink-400">No visitor activity recorded yet for this range.</p>;
  }

  return (
    <div className="space-y-4">
      {steps.map((step) => {
        const isBottleneck = step.key === bottleneckKey;
        const isRealDrop = step.pctOfPrevious !== null && step.pctOfPrevious <= 100;
        const grewFromPrevious = step.pctOfPrevious !== null && step.pctOfPrevious > 100;

        return (
          <div key={step.key}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink-800">{step.label}</span>
                {isBottleneck && (
                  <span className="flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-[11px] font-semibold text-warning-600">
                    <AlertTriangle size={11} /> Biggest drop-off
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold tabular-nums text-ink-900">{step.sessions.toLocaleString("en-BD")}</span>
                <span className="text-ink-400">· {step.pctOfLanding.toFixed(1)}% of landing</span>
                {isRealDrop && (
                  <span className="flex items-center gap-0.5 font-medium text-danger-600">
                    <ArrowDown size={11} /> {(100 - step.pctOfPrevious!).toFixed(1)}% drop
                  </span>
                )}
                {grewFromPrevious && (
                  <span className="flex items-center gap-0.5 font-medium text-ink-500" title="More sessions reached this step directly than passed through the previous one — not a drop-off.">
                    <ArrowUpRight size={11} /> direct entries
                  </span>
                )}
              </div>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className={cn("h-full rounded-full transition-all duration-500 ease-smooth", isBottleneck ? "bg-danger-500" : "bg-brass-400")}
                style={{ width: `${Math.min(100, Math.max(step.pctOfLanding, step.sessions > 0 ? 1 : 0))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
