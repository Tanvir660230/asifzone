"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, ChevronLeft, ChevronRight, Circle, MinusCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { SegmentedControl } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/admin/empty-state";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { useCapabilities } from "@/hooks/use-capability";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { AlertSeverity, ChecklistStep, MonthEndChecklist } from "@/lib/api/finance";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type View = "alerts" | "month-end";
const SEVERITY: Record<AlertSeverity, { label: string; variant: "danger" | "warning" | "info" }> = {
  critical: { label: "Critical", variant: "danger" },
  warning: { label: "Warning", variant: "warning" },
  info: { label: "For your information", variant: "info" },
};
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** What needs the owner's attention in the books (docs/FINANCE_ALERTS.md), and the month-end close checklist. Every
 * alert is computed from the books, links to where it is fixed and clears by itself once it is. */
export default function FinanceAttentionPage() {
  const { can, ready } = useCapabilities();
  const params = useSearchParams();
  const [view, setView] = useState<View>(params.get("view") === "month-end" ? "month-end" : "alerts");
  if (ready && !can("finance.view")) {
    return (
      <div>
        <ModuleTabs />
        <EmptyState icon={BellRing} title="Finance alerts aren't available to your role" />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ModuleTabs />
      <PageHeader title="Needs attention" description="What is waiting in the books, and what's left before a month can be closed." />
      <SegmentedControl aria-label="View" options={[{ value: "alerts" as const, label: "Alerts" }, { value: "month-end" as const, label: "Month-end close" }]} value={view} onChange={setView} />
      {view === "alerts" ? <Alerts /> : <MonthEnd initialMonth={params.get("month")} canClose={can("finance.period_close")} />}
    </div>
  );
}

function Alerts() {
  const q = useQuery({ queryKey: financeApi.alertKeys.all, queryFn: financeApi.getFinanceAlerts });
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="Alerts couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const { alerts, counts, asOf } = q.data;
  if (!alerts.length) {
    return <EmptyState variant="bordered" icon={CheckCircle2} title="Nothing needs attention" description={`Every event is posted, nothing is overdue and every check matches (as of ${asOf}).`} testId="alerts-empty" />;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600" data-testid="alert-counts">
        {[counts.critical && `${counts.critical} critical`, counts.warning && `${counts.warning} to deal with`, counts.info && `${counts.info} for your information`].filter(Boolean).join(" · ")} — as of {asOf}
      </p>
      <Card className="divide-y divide-line p-0">
        {alerts.map((a) => (
          <div key={a.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4" data-testid={`alert-${a.key}`}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={SEVERITY[a.severity].variant} dot>{SEVERITY[a.severity].label}</Badge>
                <span className="font-medium text-ink-900">{a.title}</span>
                <span className="tabular-nums text-ink-600">({a.count})</span>
              </div>
              {a.detail && <p className="break-words text-sm text-ink-600">{a.detail}</p>}
            </div>
            {a.amount !== null && <span className="shrink-0 text-sm font-medium tabular-nums text-ink-900 sm:text-right">{formatPrice(a.amount)}</span>}
            <Link href={a.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 self-start sm:self-auto")}>{a.action}</Link>
          </div>
        ))}
      </Card>
    </div>
  );
}

const STEP_ICON: Record<ChecklistStep["status"], { icon: typeof Circle; className: string; label: string }> = {
  DONE: { icon: CheckCircle2, className: "text-success-600", label: "Done" },
  TODO: { icon: Circle, className: "text-warning-600", label: "To do" },
  NOT_APPLICABLE: { icon: MinusCircle, className: "text-ink-400", label: "Not needed" },
};

function MonthEnd({ initialMonth, canClose }: { initialMonth: string | null; canClose: boolean }) {
  const [month, setMonth] = useState<string | null>(initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : null);
  const [closing, setClosing] = useState<"close" | "reopen" | null>(null);
  const q = useQuery({ queryKey: financeApi.alertKeys.monthEnd(month ?? "default"), queryFn: () => financeApi.getMonthEnd(month ?? undefined) });
  if (q.isLoading) return <Skeleton className="h-80 w-full" />;
  if (q.isError || !q.data) return <Alert variant="danger" title="The checklist couldn't be loaded" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>;
  const c = q.data;
  const current = c.asOf.slice(0, 7);
  const shift = (n: number) => setMonth(monthKey(monthIndex(c.month) + n));
  const closed = c.period?.status === "CLOSED";
  const done = c.steps.filter((s) => s.status !== "TODO").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton aria-label="Previous month" variant="ghost" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></IconButton>
          <h2 className="min-w-40 text-center text-lg font-semibold text-ink-900" data-testid="month-label">{monthLabel(c.month)}</h2>
          <IconButton aria-label="Next month" variant="ghost" onClick={() => shift(1)} disabled={c.month >= current}><ChevronRight className="h-4 w-4" /></IconButton>
        </div>
        <div className="flex items-center gap-2">
          {!c.period ? <Badge variant="outline">Nothing posted</Badge> : closed ? <Badge variant="success" dot>Closed</Badge> : c.period.status === "SOFT_CLOSED" ? <Badge variant="warning" dot>Soft-closed</Badge> : <Badge variant="neutral" dot>Open</Badge>}
          <span className="text-sm tabular-nums text-ink-600" data-testid="steps-done">{done} of {c.steps.length} done</span>
        </div>
      </div>

      {!c.ended && <Alert variant="info" title="This month hasn't ended yet">The checklist shows where things stand; a month can be closed once it has ended.</Alert>}

      <Card className="divide-y divide-line p-0">
        {c.steps.map((s) => {
          const icon = STEP_ICON[s.status];
          const Icon = icon.icon;
          return (
            <div key={s.key} className="flex items-start gap-3 p-4" data-testid={`step-${s.key}`} data-status={s.status}>
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", icon.className)} aria-label={icon.label} />
              <div className="min-w-0 flex-1">
                <p className={cn("font-medium", s.status === "NOT_APPLICABLE" ? "text-ink-500" : "text-ink-900")}>{s.label}</p>
                <p className="break-words text-sm text-ink-600">{s.detail}</p>
              </div>
              {s.status === "TODO" && <Link href={s.href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")}>Open</Link>}
            </div>
          );
        })}
      </Card>

      {c.period && canClose && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-700">
            {closed
              ? "This month is closed: nothing more can be posted into it. Reopen it only to correct a mistake."
              : c.ready
                ? "Everything is done. Closing the month stops further postings into it."
                : c.ended ? `${c.open} ${c.open === 1 ? "step is" : "steps are"} still open. You can close anyway, with a reason.` : "Close the month after it has ended."}
          </p>
          {closed
            ? <Button variant="outline" size="sm" onClick={() => setClosing("reopen")}>Reopen month</Button>
            : <Button size="sm" variant={c.ready ? "primary" : "outline"} disabled={!c.ended} onClick={() => setClosing("close")} data-testid="close-month">Close {monthLabel(c.month)}</Button>}
        </div>
      )}
      {!c.period && <p className="text-sm text-ink-600">Nothing has been posted into this month, so there is nothing to close.</p>}
      {closing && c.period && <PeriodModal checklist={c} transition={closing} onClose={() => setClosing(null)} />}
    </div>
  );
}

function PeriodModal({ checklist, transition, onClose }: { checklist: MonthEndChecklist; transition: "close" | "reopen"; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => financeApi.changePeriod(checklist.period!.id, transition, reason.trim()),
    onSuccess: () => {
      toast.success(`${monthLabel(checklist.month)} ${transition === "close" ? "closed" : "reopened"}`);
      void qc.invalidateQueries({ queryKey: ["finance", "month-end"] });
      void qc.invalidateQueries({ queryKey: financeApi.alertKeys.all });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, `The month couldn't be ${transition === "close" ? "closed" : "reopened"}`)),
  });
  const title = `${transition === "close" ? "Close" : "Reopen"} ${monthLabel(checklist.month)}`;
  return (
    <Modal open onClose={onClose} title={title} widthClassName="max-w-md"
      description={transition === "close" ? "Nothing more can be posted into a closed month. The reason is kept in the audit log." : "Postings into this month become possible again. The reason is kept in the audit log."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={reason.trim().length < 3} onClick={() => save.mutate()} data-testid="confirm-period">{transition === "close" ? "Close month" : "Reopen month"}</Button></>}>
      <div className="space-y-3">
        {transition === "close" && checklist.open > 0 && <Alert variant="warning" title={`${checklist.open} ${checklist.open === 1 ? "step is" : "steps are"} still open`}>Say why the month is being closed anyway.</Alert>}
        <Field htmlFor="period-reason" label="Reason" required>
          <Textarea id="period-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={transition === "close" ? "October books reviewed" : "Supplier bill dated in this month arrived late"} />
        </Field>
      </div>
    </Modal>
  );
}
