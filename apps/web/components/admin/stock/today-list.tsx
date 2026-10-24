"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Droplets, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StockToday } from "@/lib/api/stock-smart";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { num, spacedUnit } from "./stock-shared";

/**
 * Today on the stock page (docs/STOCK_HUB.md §7): only what needs doing — bottles to fill, items to reorder, this week's
 * count, count losses to approve — each with the one action that does it. Nothing to do reads "All caught up".
 */

type Tone = "info" | "warning" | "success" | "danger";
const TONE: Record<Tone, string> = {
  info: "bg-info-100 text-info-700",
  warning: "bg-warning-100 text-warning-700",
  success: "bg-success-100 text-success-700",
  danger: "bg-danger-100 text-danger-700",
};

function Task({ icon: Icon, tone, title, detail, chips, action, testId }: { icon: typeof Droplets; tone: Tone; title: ReactNode; detail?: ReactNode; chips?: ReactNode; action?: ReactNode; testId: string }) {
  return (
    <li data-testid={testId} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <span className={cn("grid h-10 w-10 place-items-center rounded-xl", TONE[tone])} aria-hidden="true"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-fg">{title}</p>
        {detail && <p className="mt-0.5 text-sm text-fg-muted">{detail}</p>}
        {chips && <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>}
      </div>
      {action && <div className="col-start-2 sm:col-start-auto">{action}</div>}
    </li>
  );
}

const Chip = ({ children, tone }: { children: ReactNode; tone?: "warning" }) => (
  <span className={cn("rounded-full px-2.5 py-0.5 text-xs tabular-nums", tone === "warning" ? "bg-warning-100 text-warning-700" : "bg-ink-900/[0.05] text-fg")}>{children}</span>
);

function chipsOf<T>(rows: T[], render: (r: T) => ReactNode, max = 3) {
  return (
    <>
      {rows.slice(0, max).map(render)}
      {rows.length > max && <Chip>+{rows.length - max} more</Chip>}
    </>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const REASON: Record<string, string> = { DAMAGED: "damaged", LOST: "lost", SAMPLE: "given as samples", COUNT_FIX: "a miscount" };

export interface TodayActions {
  onFill?: () => void;
  onReorder?: () => void;
  onCount?: () => void;
  onApproval?: (id: string) => void;
}

export function TodayList({ data, isLoading, isError, onRetry, actions }: { data: StockToday | undefined; isLoading: boolean; isError: boolean; onRetry: () => void; actions: TodayActions }) {
  const tasks = data ? (data.fill ? 1 : 0) + (data.reorder ? 1 : 0) + (data.count ? 1 : 0) + data.approvals.length + data.fillProblems.length : 0;
  return (
    <section aria-labelledby="stock-today" className="space-y-3" data-testid="stock-today">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="stock-today" className="text-lg font-semibold tracking-tight text-fg">Today</h2>
        {data && tasks > 0 && <p className="text-sm text-fg-muted">{plural(tasks, "thing")} to do</p>}
      </div>
      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading today's tasks">
            {[0, 1].map((k) => <div key={k} className="flex gap-3"><Skeleton className="h-10 w-10 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-1/3" /></div></div>)}
          </div>
        ) : isError ? (
          <p className="px-5 py-4 text-sm text-fg-muted">Today&apos;s tasks couldn&apos;t be loaded. <button type="button" onClick={onRetry} className="font-medium text-fg underline underline-offset-4">Try again</button></p>
        ) : !data || tasks === 0 ? (
          <ul><Task testId="today-clear" icon={CheckCircle2} tone="success" title="All caught up" detail="Nothing to fill, reorder, count or approve right now." /></ul>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {data.fill && (
              <Task
                testId="today-fill"
                icon={Droplets}
                tone="info"
                title={`Fill ${plural(data.fill.bottles, "bottle")} for ${plural(data.fill.orders, "order")}`}
                detail={data.fill.short.length
                  ? <span className="text-warning-700">Not enough {data.fill.short.map((s) => `${s.name} (need ${num(s.need)} ${spacedUnit(s.unit)}, have ${num(s.have)})`).join(", ")}</span>
                  : "Everything needed is in stock"}
                chips={chipsOf(data.fill.lines, (l) => <Chip key={l.variantId}>{l.name} × {num(l.owed)}</Chip>)}
                action={actions.onFill && <Button onClick={actions.onFill} data-testid="today-fill-open">Mark filled</Button>}
              />
            )}
            {data.fillProblems.map((p) => (
              <Task
                key={`${p.orderNumber}-${p.variantId}`}
                testId="today-fill-problem"
                icon={AlertTriangle}
                tone="danger"
                title={`${plural(p.units, "booked bottle")} couldn't be filled`}
                detail={`${p.orderNumber} · ${p.name}: ${p.reason}`}
              />
            ))}
            {data.reorder && (
              <Task
                testId="today-reorder"
                icon={ShoppingBag}
                tone="warning"
                title={`Reorder ${plural(data.reorder.items.length, "item")}${data.reorder.suppliers > 1 ? ` from ${num(data.reorder.suppliers)} suppliers` : ""}`}
                detail={orderByWords(data.reorder.items[0]!.orderBy, data.today)}
                chips={chipsOf(byProduct(data.reorder.items), (g) => <Chip key={g.productName} tone="warning">{g.words}</Chip>)}
                action={actions.onReorder && <Button variant="outline" onClick={actions.onReorder} data-testid="today-reorder-open">Review</Button>}
              />
            )}
            {data.count && (
              <Task
                testId="today-count"
                icon={ClipboardCheck}
                tone="success"
                title={`This week's count: ${plural(data.count.due.length, "item")}`}
                detail={`About ${plural(data.count.minutes, "minute")} · the items you use most come up most often`}
                chips={chipsOf(data.count.due, (d) => <Chip key={d.variantId}>{d.name}</Chip>)}
                action={actions.onCount && <Button variant="outline" onClick={actions.onCount} data-testid="today-count-open">Start</Button>}
              />
            )}
            {data.approvals.map((a) => (
              <Task
                key={a.id}
                testId="today-approval"
                icon={AlertTriangle}
                tone="danger"
                title={a.value !== null ? `Approve a loss of ${formatPrice(a.value)}` : "Approve a count loss"}
                detail={`${a.name}: ${num(-a.difference)} short, ${REASON[a.reason] ?? a.reason.toLowerCase()}${a.requestedBy ? ` · counted by ${a.requestedBy}` : ""} on ${formatBookDate(a.countedOn)}`}
                action={actions.onApproval && <Button variant="outline" onClick={() => actions.onApproval!(a.id)} data-testid="today-approval-open">Review</Button>}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

type ReorderRow = NonNullable<StockToday["reorder"]>["items"][number];

/** Sizes of one product in one chip: "Premium Pakistani Cap - Black A · 3 sizes out", "Empty attar bottle 12 ml · 9 days left". */
function byProduct(rows: ReorderRow[]): Array<{ productName: string; words: string }> {
  const groups = new Map<string, ReorderRow[]>();
  for (const r of rows) groups.set(r.productName, [...(groups.get(r.productName) ?? []), r]);
  return [...groups.entries()].map(([productName, rs]) => {
    const out = rs.filter((r) => r.status === "OUT" || r.daysLeft === 0).length;
    if (rs.length === 1) {
      const r = rs[0]!;
      return { productName, words: `${r.name} · ${out ? "out" : r.daysLeft === null ? "low" : `${plural(r.daysLeft, "day")} left`}` };
    }
    const soonest = Math.min(...rs.map((r) => r.daysLeft ?? Infinity));
    return { productName, words: `${productName} · ${out ? `${plural(out, "size")} out` : Number.isFinite(soonest) ? `${plural(rs.length, "size")}, ${plural(soonest, "day")} left` : `${plural(rs.length, "size")} low`}` };
  });
}

function orderByWords(orderBy: string, today: string): string {
  if (orderBy <= today) return "Order today so it arrives before you run out";
  return `Order by ${formatBookDate(orderBy)} so it arrives before you run out`;
}
