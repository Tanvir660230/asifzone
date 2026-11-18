"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useCapability } from "@/hooks/use-capability";
import { describeApiError } from "@/lib/api-client";
import * as targetsApi from "@/lib/api/targets";
import { formatPriceWhole } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS: Record<targetsApi.TargetStatus, { label: string; variant: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  ahead: { label: "Ahead", variant: "success" },
  "on-track": { label: "On track", variant: "info" },
  behind: { label: "Behind", variant: "warning" },
  met: { label: "Met", variant: "success" },
  missed: { label: "Missed", variant: "danger" },
  "no-target": { label: "No target", variant: "neutral" },
};

function monthName(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

/**
 * This month against the owner's targets (docs/superpowers/plans/2026-11-18-business-reports.md, Part 1): net sales,
 * orders and — for those who read the books — profit, each with how much is done, where a steady pace would be today
 * (the tick on the bar) and where the month is heading. The owner sets the targets here.
 */
export function MonthTargets({ className }: { className?: string }) {
  const month = targetsApi.monthOf();
  const canSet = useCapability("settings.manage");
  const q = useQuery({ queryKey: targetsApi.targetsKeys.month(month), queryFn: () => targetsApi.getMonthTargets(month), staleTime: 60_000 });
  const [editing, setEditing] = useState(false);

  if (q.isError) {
    return (
      <Card className={cn("flex items-center justify-between gap-3 p-4 text-sm", className)} data-testid="month-targets">
        <span className="text-fg-muted">Couldn&rsquo;t load this month&rsquo;s targets.</span>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }
  if (!q.data) return <Skeleton className={cn("h-40 w-full rounded-2xl", className)} />;

  const d = q.data;
  const rows = [
    { key: "netSales", label: "Net sales", p: d.netSales, fmt: (n: number) => formatPriceWhole(n, d.currency) },
    { key: "orders", label: "Orders", p: d.orders, fmt: (n: number) => Math.round(n).toLocaleString("en-IN") },
    ...(d.profit ? [{ key: "profit", label: "Profit", p: d.profit, fmt: (n: number) => formatPriceWhole(n, d.currency) }] : []),
  ];
  const anyTarget = rows.some((r) => r.p.target !== null);

  return (
    <Card className={cn("p-4 sm:p-5", className)} data-testid="month-targets">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">{monthName(d.month)} targets</h2>
          <p className="text-xs text-fg-muted">
            {d.finished ? "Month closed" : `Day ${d.elapsedDays} of ${d.daysInMonth}`}
            {d.updatedBy && ` · set by ${d.updatedBy}`}
          </p>
        </div>
        {canSet && (
          <Button size="sm" variant={anyTarget ? "outline" : "primary"} onClick={() => setEditing(true)} className="print:hidden">
            <Target size={14} aria-hidden /> {anyTarget ? "Edit targets" : "Set targets"}
          </Button>
        )}
      </div>

      {!anyTarget && (
        <p className="mt-3 text-sm text-fg-muted">
          {canSet ? "Set this month's sales, orders and profit targets to see each day whether the month is on course." : "No targets set for this month yet — the owner sets them."}
        </p>
      )}

      <div className={cn("mt-4 grid gap-4", rows.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
        {rows.map(({ key, label, p, fmt }) => (
          <TargetRow key={key} label={label} p={p} fmt={fmt} />
        ))}
      </div>

      {editing && <SetTargetsDialog month={d.month} current={d} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function TargetRow({ label, p, fmt }: { label: string; p: targetsApi.TargetProgress; fmt: (n: number) => string }) {
  const status = STATUS[p.status];
  const done = p.target ? Math.max(0, Math.min(100, (p.actual / p.target) * 100)) : 0;
  const pace = p.target && p.expectedByToday !== null ? Math.min(100, (p.expectedByToday / p.target) * 100) : null;
  return (
    <div className="min-w-0" data-testid={`target-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-fg-muted">{label}</span>
        {p.target !== null && <Badge variant={status.variant}>{status.label}</Badge>}
      </div>
      <p className="mt-0.5 tabular-nums">
        <span className="text-lg font-semibold text-fg">{fmt(p.actual)}</span>
        {p.target !== null && <span className="text-sm text-fg-muted"> of {fmt(p.target)}</span>}
      </p>
      {p.target !== null ? (
        <>
          <div
            className="relative mt-2 h-2 rounded-full bg-ink-100"
            role="progressbar"
            aria-label={`${label}: ${Math.round(p.percentDone ?? 0)}% of the target`}
            aria-valuenow={Math.round(done)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={cn("h-full rounded-full", p.status === "behind" || p.status === "missed" ? "bg-warning-500" : "bg-success-500")} style={{ width: `${done}%` }} />
            {pace !== null && pace > 0 && pace < 100 && <span className="absolute -top-1 h-4 w-0.5 rounded bg-fg" style={{ left: `${pace}%` }} title={`Steady pace today: ${fmt(p.expectedByToday ?? 0)}`} aria-hidden />}
          </div>
          <p className="mt-1.5 text-xs text-fg-muted tabular-nums">
            {Math.round(p.percentDone ?? 0)}% done · {p.status === "met" || p.status === "missed" ? "final" : `heading for ${fmt(p.projected)}`}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-xs text-fg-muted tabular-nums">Heading for {fmt(p.projected)} this month</p>
      )}
    </div>
  );
}

function SetTargetsDialog({ month, current, onClose }: { month: string; current: targetsApi.MonthTargets; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({
    netSales: current.netSales.target?.toString() ?? "",
    orders: current.orders.target?.toString() ?? "",
    profit: current.profit?.target?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  const parse = (v: string, whole = false) => {
    const t = v.replace(/[,\s৳]/g, "");
    if (t === "") return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n))) return NaN;
    return n;
  };

  const save = useMutation({
    mutationFn: () => {
      const input: targetsApi.MonthTargetsInput = { netSales: parse(values.netSales), orders: parse(values.orders, true), ...(current.profit ? { profit: parse(values.profit) } : {}) };
      if (Object.values(input).some((n) => Number.isNaN(n))) throw new Error("Each target is a number above zero (orders a whole number), or left empty.");
      return targetsApi.setMonthTargets(month, input);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(targetsApi.targetsKeys.month(month), data);
      toast.success(`${monthName(month)} targets saved`);
      onClose();
    },
    onError: (err) => setError(err instanceof Error && !("status" in err) ? err.message : describeApiError(err, "Couldn't save the targets")),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${monthName(month)} targets`}
      description="Leave a box empty for no target. Progress is measured against a steady pace through the month."
      widthClassName="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} data-testid="save-targets">
            Save targets
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {error && <p className="text-sm text-danger-600">{error}</p>}
        <Field htmlFor="target-net-sales" label="Net sales (৳)" hint="Delivered sales after discounts and returns — the Reports figure.">
          <Input id="target-net-sales" inputMode="numeric" value={values.netSales} onChange={(e) => setValues({ ...values, netSales: e.target.value })} placeholder="e.g. 300000" />
        </Field>
        <Field htmlFor="target-orders" label="Orders" hint="Orders placed in the month.">
          <Input id="target-orders" inputMode="numeric" value={values.orders} onChange={(e) => setValues({ ...values, orders: e.target.value })} placeholder="e.g. 400" />
        </Field>
        {current.profit && (
          <Field htmlFor="target-profit" label="Profit (৳)" hint="Profit in the books, after goods, delivery, ads and running costs.">
            <Input id="target-profit" inputMode="numeric" value={values.profit} onChange={(e) => setValues({ ...values, profit: e.target.value })} placeholder="e.g. 60000" />
          </Field>
        )}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
