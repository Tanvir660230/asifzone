"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Droplets, PackagePlus, Truck, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { getErrorMessage } from "@/lib/api-client";
import { getStockActivity, smartKeys, type StockActivity, type StockEvent, type StockEventKind } from "@/lib/api/stock-smart";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ThumbStack } from "./item-thumb";
import { num, spacedUnit } from "./stock-shared";

/**
 * What happened to the stock (docs/STOCK_HUB.md §7), newest first: who did what, to which items (with their pictures), and
 * what was done today. Fills recorded at courier booking say so; anything still waiting is marked.
 */

type Filter = "ALL" | "BOUGHT" | "FILLED" | "COUNTED";
const FILTER_KINDS: Record<Filter, StockEventKind[] | null> = {
  ALL: null,
  BOUGHT: ["BOUGHT"],
  FILLED: ["FILLED", "AUTO_FILLED", "FILL_PROBLEM"],
  COUNTED: ["COUNTED", "APPROVED", "REJECTED"],
};

const LOOK: Record<StockEventKind, { icon: LucideIcon; tone: string }> = {
  BOUGHT: { icon: PackagePlus, tone: "bg-info-100 text-info-700" },
  FILLED: { icon: Droplets, tone: "bg-accent/10 text-accent" },
  AUTO_FILLED: { icon: Truck, tone: "bg-accent/10 text-accent" },
  COUNTED: { icon: ClipboardCheck, tone: "bg-success-100 text-success-700" },
  APPROVED: { icon: CheckCircle2, tone: "bg-success-100 text-success-700" },
  REJECTED: { icon: XCircle, tone: "bg-ink-900/[0.06] text-fg-muted" },
  FILL_PROBLEM: { icon: AlertTriangle, tone: "bg-danger-100 text-danger-700" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const qty = (n: number, unit: string) => (unit === "pcs" ? num(n) : `${num(n)} ${spacedUnit(unit)}`);

function titleOf(e: StockEvent): ReactNode {
  const first = e.items[0];
  const more = e.items.length - 1;
  const one = first ? <><b className="font-semibold">{first.name}</b>{more > 0 && <> and {plural(more, "more item")}</>}</> : "items";
  switch (e.kind) {
    case "BOUGHT":
      return <>Received {e.items.length === 1 && first ? <>{qty(first.change ?? 0, first.unit)} {one}</> : one}{e.context && <> from {e.context}</>}</>;
    case "FILLED":
      return <>Filled {first ? <>{plural(first.change ?? 0, "bottle")} of <b className="font-semibold">{first.name}</b></> : "bottles"}</>;
    case "AUTO_FILLED":
      return <>{first ? plural(first.change ?? 0, "bottle") : "Bottles"} of <b className="font-semibold">{first?.name}</b> recorded as filled at booking</>;
    case "COUNTED": {
      const counted = Number(e.context ?? 0);
      return e.items.length === 0 ? <>Counted {plural(counted, "item")} — all matched</> : <>Counted {plural(counted, "item")} — {plural(e.items.length, "difference")}</>;
    }
    case "APPROVED":
      return <>Approved a loss{e.value !== null && <> of {formatPrice(e.value)}</>} on {one}</>;
    case "REJECTED":
      return <>Rejected a count loss on {one}</>;
    case "FILL_PROBLEM":
      return <>Couldn&apos;t record {first ? plural(first.change ?? 0, "bottle") : "bottles"} of <b className="font-semibold">{first?.name}</b> for {e.context}</>;
  }
}

function whenOf(at: string) {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function dayOf(at: string, today: string) {
  const d = new Date(at).toLocaleDateString("en-CA");
  if (d === today) return "Today";
  const y = new Date(`${today}T00:00:00`);
  y.setDate(y.getDate() - 1);
  if (d === y.toLocaleDateString("en-CA")) return "Yesterday";
  return formatBookDate(d);
}

function Event({ e }: { e: StockEvent }) {
  const look = LOOK[e.kind];
  const Icon = look.icon;
  const counted = e.kind === "COUNTED" && e.items.length > 0;
  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 py-3" data-testid="activity-event" data-kind={e.kind}>
      <span className={cn("relative z-[1] grid h-8 w-8 place-items-center rounded-full", look.tone)} aria-hidden="true"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm leading-snug text-fg">{titleOf(e)}</p>
        <p className="text-xs text-fg-muted">
          {whenOf(e.at)} · {e.kind === "AUTO_FILLED" ? "courier booking" : e.by ?? "—"}
          {e.pending && <span className="ml-1.5 rounded-full bg-warning-100 px-1.5 py-px font-medium text-warning-700">{e.kind === "COUNTED" ? "loss waits for approval" : e.kind === "FILL_PROBLEM" ? "needs Try again" : "not finished"}</span>}
        </p>
        {counted && (
          <ul className="space-y-0.5 text-xs">
            {e.items.slice(0, 3).map((i) => <li key={i.variantId} className="flex justify-between gap-2"><span className="truncate text-fg-muted">{i.name}</span><span className={cn("tabular-nums", (i.change ?? 0) < 0 ? "text-danger-700" : "text-success-700")}>{(i.change ?? 0) > 0 ? "+" : ""}{num(i.change ?? 0)}</span></li>)}
          </ul>
        )}
        {!counted && e.items.length > 1 && <ThumbStack items={e.items} />}
        {e.note && <p className="text-xs text-fg-muted">{e.note}</p>}
      </div>
    </li>
  );
}

export function DoneToday({ today }: { today: StockActivity["today"] | undefined }) {
  if (!today) return null;
  const parts = [
    today.purchases ? plural(today.purchases, "purchase") : null,
    today.bottlesFilled ? `${plural(today.bottlesFilled, "bottle")} filled` : null,
    today.counts ? plural(today.counts, "count") : null,
    today.decisions ? plural(today.decisions, "decision") : null,
  ].filter(Boolean);
  return <p className="text-sm text-fg-muted" data-testid="activity-done-today">{parts.length ? <>Done today: <span className="text-fg">{parts.join(" · ")}</span></> : "Nothing recorded yet today."}</p>;
}

export function ActivityPanel({ className }: { className?: string }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [limit, setLimit] = useState(30);
  const q = useQuery({ queryKey: smartKeys.activity(limit), queryFn: () => getStockActivity(limit), placeholderData: (p) => p });
  const kinds = FILTER_KINDS[filter];
  const events = (q.data?.events ?? []).filter((e) => !kinds || kinds.includes(e.kind));
  const today = q.data?.today.date ?? new Date().toLocaleDateString("en-CA");
  const days: Array<{ label: string; events: StockEvent[] }> = [];
  for (const e of events) {
    const label = dayOf(e.at, today);
    const last = days[days.length - 1];
    if (last && last.label === label) last.events.push(e);
    else days.push({ label, events: [e] });
  }

  return (
    <section aria-labelledby="stock-activity" className={cn("space-y-3", className)} data-testid="activity-panel">
      <div className="space-y-1">
        <h2 id="stock-activity" className="text-lg font-semibold tracking-tight text-fg">Activity</h2>
        <DoneToday today={q.data?.today} />
      </div>
      <SegmentedControl aria-label="Show activity" value={filter} onChange={setFilter} options={[
        { value: "ALL", label: "All" }, { value: "BOUGHT", label: "Received" }, { value: "FILLED", label: "Filled" }, { value: "COUNTED", label: "Counted" },
      ]} />
      {q.isLoading ? (
        <div className="space-y-4 pt-2" aria-busy="true" aria-label="Loading activity">{[0, 1, 2, 3].map((k) => <div key={k} className="flex gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-1/3" /></div></div>)}</div>
      ) : q.isError ? (
        <p className="text-sm text-fg-muted">{getErrorMessage(q.error, "The activity couldn't be loaded.")} <button type="button" onClick={() => q.refetch()} className="font-medium text-fg underline underline-offset-4">Try again</button></p>
      ) : events.length === 0 ? (
        <p className="py-6 text-sm text-fg-muted" data-testid="activity-empty">{filter === "ALL" ? "Nothing has been recorded here yet. Purchases, fills and counts appear as they happen." : "Nothing of this kind yet."}</p>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <div key={d.label}>
              <p className="text-xs font-medium text-fg-muted">{d.label}</p>
              {/* a thin line joins the icons of one day */}
              <ol className="relative before:absolute before:bottom-4 before:left-4 before:top-4 before:w-px before:bg-line-subtle">
                {d.events.map((e) => <Event key={`${e.kind}-${e.id}`} e={e} />)}
              </ol>
            </div>
          ))}
          {(q.data?.events.length ?? 0) >= limit && limit < 100 && (
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => Math.min(100, l + 30))} loading={q.isFetching} data-testid="activity-more">Show earlier</Button>
          )}
        </div>
      )}
    </section>
  );
}
