"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Newspaper } from "lucide-react";
import { Card } from "@/components/ui/card";
import * as analyticsApi from "@/lib/api/admin-analytics";
import { formatBusinessDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1));

/** Anomalies are bad news when a good thing fell or a bad thing rose. */
const BAD_WHEN_UP = new Set(["returned", "cancelled"]);

/** "Unusual today": counts far from the same weekday's recent history (§4.9). Nothing renders on a normal day. */
export function AnomalyStrip({ date, isToday }: { date: string; isToday: boolean }) {
  const { data } = useQuery({
    queryKey: ["anomalies", isToday ? null : date],
    queryFn: () => analyticsApi.getAnomalies(isToday ? undefined : date),
    refetchInterval: isToday ? 60_000 : false,
  });
  if (!data || data.anomalies.length === 0) return null;
  return (
    <section aria-label={isToday ? "Unusual today" : "Unusual on this day"} className="rounded-xl border border-warning-100 bg-warning-50/60 p-3.5 sm:p-4">
      <h3 className="text-[13px] font-semibold text-warning-700">{isToday ? "Unusual today, so far" : "Unusual on this day"}</h3>
      <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {data.anomalies.map((a) => {
          const bad = BAD_WHEN_UP.has(a.key) ? a.direction === "up" : a.direction === "down";
          const Icon = a.direction === "up" ? ArrowUpRight : ArrowDownRight;
          return (
            <li key={a.key} className="flex items-start gap-2 text-[13px] text-fg">
              <Icon size={15} className={cn("mt-0.5 shrink-0", bad ? "text-danger-600" : "text-success-700")} aria-hidden="true" />
              <span>
                <span className="font-medium">{a.label}</span> {a.direction === "up" ? "up" : "down"}: {fmt(a.value)}
                <span className="text-fg-muted"> against a usual {fmt(a.expected)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The daily brief: a finished day in a few sentences. Viewing today shows yesterday's, with what was unusual about it and
 * the work waiting now; for a past day the strip above already lists its anomalies, and today's queues don't belong. */
export function BriefCard({ date, isToday }: { date: string; isToday: boolean }) {
  const { data, isError } = useQuery({
    queryKey: ["daily-brief", isToday ? null : date],
    queryFn: () => analyticsApi.getDailyBrief(isToday ? undefined : date),
  });
  if (isError) return null;
  if (!data) return <div className="h-28 animate-pulse rounded-xl bg-ink-900/[0.04]" aria-busy="true" aria-label="Loading the brief" />;
  return (
    <Card className="p-4 sm:p-5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-fg-muted">
        <Newspaper size={13} aria-hidden="true" />
        {isToday ? "Yesterday's brief" : "Brief"} · {formatBusinessDate(data.date, { weekday: "short", month: "short", day: "numeric" })}
      </p>
      <p className="mt-1.5 text-[16px] font-semibold leading-snug text-fg sm:text-[17px]">{data.headline}</p>
      {data.lines.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[13.5px] leading-relaxed text-fg-muted">
          {data.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {isToday && data.unusual.length > 0 && <BriefList title="Unusual yesterday" items={data.unusual} />}
      {isToday && data.todo.length > 0 && <BriefList title="Waiting right now" items={data.todo} />}
    </Card>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-[12.5px] font-semibold text-fg">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13.5px] leading-relaxed text-fg">
        {items.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
