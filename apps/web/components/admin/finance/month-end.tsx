"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, MinusCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ApiError, getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { ChecklistStep, MonthEndChecklist } from "@/lib/api/finance";
import { cn } from "@/lib/utils";

/**
 * The month-end close (docs/FINANCE_ALERTS.md §2; blueprint P0.7 / P1.6): every step the books need before a month is
 * Final, each with a link to where it is done, and closing or reopening the month with a reason. Books › Month-end.
 */
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
export const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const STEP_ICON: Record<ChecklistStep["status"], { icon: typeof Circle; className: string; label: string }> = {
  DONE: { icon: CheckCircle2, className: "text-success-600", label: "Done" },
  TODO: { icon: Circle, className: "text-warning-600", label: "To do" },
  NOT_APPLICABLE: { icon: MinusCircle, className: "text-ink-400", label: "Not needed" },
};

export function MonthEnd({ initialMonth, canClose }: { initialMonth: string | null; canClose: boolean }) {
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
          {/* blueprint I-4: Final only once closed with every step done — a closed month with open steps is still Draft */}
          {c.label && c.period && <Badge variant={c.label === "FINAL" ? "success" : "outline"} title={c.label === "FINAL" ? "Closed with every step done — the figures are final" : "Figures can still change until the month is closed with every step done"} data-testid="month-final-label">{c.label === "FINAL" ? "Final" : "Draft"}</Badge>}
          <span className="text-sm tabular-nums text-ink-600" data-testid="steps-done">{done} of {c.steps.length} done</span>
        </div>
      </div>

      {/* how far the month is: one glance instead of counting ticks */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200/70" role="progressbar" aria-label="Month-end steps done" aria-valuemin={0} aria-valuemax={c.steps.length} aria-valuenow={done}>
        <div className={cn("h-full rounded-full transition-[width] duration-base ease-smooth", done === c.steps.length ? "bg-success-500" : "bg-accent")} style={{ width: `${c.steps.length ? (done / c.steps.length) * 100 : 0}%` }} />
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
  // a month already shared with partners: the server asks for it to be said out loud before reopening
  const [sharesShared, setSharesShared] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const save = useMutation({
    mutationFn: () => financeApi.changePeriod(checklist.period!.id, transition, reason.trim(), acknowledged),
    onSuccess: () => {
      toast.success(`${monthLabel(checklist.month)} ${transition === "close" ? "closed" : "reopened"}`);
      void qc.invalidateQueries({ queryKey: ["finance", "month-end"] });
      void qc.invalidateQueries({ queryKey: financeApi.alertKeys.all });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.details as { code?: string } | undefined)?.code === "SHARES_FINAL_ACK_REQUIRED") { setSharesShared(true); return; }
      toast.error(getErrorMessage(err, `The month couldn't be ${transition === "close" ? "closed" : "reopened"}`));
    },
  });
  const title = `${transition === "close" ? "Close" : "Reopen"} ${monthLabel(checklist.month)}`;
  return (
    <Modal open onClose={onClose} title={title} widthClassName="max-w-md"
      description={transition === "close" ? "Nothing more can be posted into a closed month. The reason is kept in the audit log." : "Postings into this month become possible again. The reason is kept in the audit log."}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={reason.trim().length < 3 || (sharesShared && !acknowledged)} onClick={() => save.mutate()} data-testid="confirm-period">{transition === "close" ? "Close month" : "Reopen month"}</Button></>}>
      <div className="space-y-3">
        {transition === "close" && checklist.open > 0 && <Alert variant="warning" title={`${checklist.open} ${checklist.open === 1 ? "step is" : "steps are"} still open`}>Say why the month is being closed anyway.</Alert>}
        {sharesShared && (
          <Alert variant="warning" title="This month's profit is already shared with partners">
            <p>Those shares stay as they are. If the month&apos;s profit changes, the difference shows up as a correction to approve — a lower profit is never taken back without an accounting decision. Close and verify the month again afterwards.</p>
            <label className="mt-2 flex items-center gap-2 font-medium text-fg">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} data-testid="ack-shares" /> I understand — reopen it
            </label>
          </Alert>
        )}
        <Field htmlFor="period-reason" label="Reason" required>
          <Textarea id="period-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder={transition === "close" ? "October books reviewed" : "Supplier bill dated in this month arrived late"} />
        </Field>
      </div>
    </Modal>
  );
}
