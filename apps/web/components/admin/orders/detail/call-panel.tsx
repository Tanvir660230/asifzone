"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Phone, PhoneCall, PhoneOff, UserRound, X } from "lucide-react";
import {
  CALLBACK_OUTCOMES,
  CONFIRMATION_ESCALATION_LABELS,
  CONFIRMATION_OUTCOME_LABELS,
  UNREACHED_OUTCOMES,
  addDays,
  businessDate,
  businessDayStartUtc,
  type ConfirmationOutcome,
  type Order,
  type OrderConfirmationState,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { listAdmins } from "@/lib/auth";
import { toDatetimeLocalValue } from "@/lib/datetime-local";
import { formatStoreDateTime } from "@/lib/format";
import { getStoreConfig } from "@/lib/store-config";
import { cn } from "@/lib/utils";
import { invalidateOrderQueries, orderKeys, type OrderPermissions } from "../order-domain";
import type { OrderCommands } from "../use-order-commands";
import { DetailSection } from "./detail-section";

/** Big, thumb-sized outcome buttons in the order an operator reaches for them. */
const OUTCOME_BUTTONS: { outcome: ConfirmationOutcome; icon?: typeof Check; tone?: "primary" | "danger" }[] = [
  { outcome: "CONFIRMED", icon: Check, tone: "primary" },
  { outcome: "NO_ANSWER", icon: PhoneOff },
  { outcome: "SWITCHED_OFF" },
  { outcome: "BUSY" },
  { outcome: "CALLBACK_REQUESTED" },
  { outcome: "WILL_CONFIRM_LATER" },
  { outcome: "WRONG_NUMBER" },
  { outcome: "DECLINED", tone: "danger" },
  { outcome: "OTHER" },
];

function storeMorning(daysAhead: number, hour = 10): Date {
  const { timezone } = getStoreConfig();
  return new Date(businessDayStartUtc(addDays(businessDate(new Date(), timezone), daysAhead), timezone).getTime() + hour * 3_600_000);
}

/** The outcome waiting for a detail (time / note) before it is saved. */
type Draft = { outcome: ConfirmationOutcome; note: string; callbackAt: string };

/**
 * The confirmation call (Order Operations plan, phase 3): call the customer, tap what happened. The order stays PENDING
 * until "Confirmed" (the normal confirmation, with its SMS) or a person cancels; "Will confirm later" only sets a
 * callback. Unanswered calls schedule the next try themselves; a wrong number or the last unanswered call escalates the
 * order to an owner or manager, who decides here. Every call is kept in the history below.
 */
export function CallPanel({ order, perms, commands }: { order: Order; perms: OrderPermissions; commands: OrderCommands }) {
  const queryClient = useQueryClient();
  const pending = order.status === "PENDING" && !order.deletedAt;
  const { data: state, isLoading, isError, refetch } = useQuery({
    queryKey: orderKeys.confirmation(order.id),
    queryFn: () => adminOrdersApi.getConfirmation(order.id),
    // A colleague may take or record the call — keep the claim and history current while this is open.
    refetchInterval: pending ? 30_000 : false,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => setDraft(null), [order.id]);

  const onDone = (s: OrderConfirmationState) => {
    queryClient.setQueryData(orderKeys.confirmation(order.id), s);
    invalidateOrderQueries(queryClient, order.id);
    setDraft(null);
  };
  const onError = (err: unknown) => {
    toast.error(getErrorMessage(err, "Couldn't save the call"));
    void refetch();
  };
  const record = useMutation({
    mutationFn: (input: { outcome: ConfirmationOutcome; note?: string; callbackAt?: string }) => adminOrdersApi.recordConfirmationAttempt(order.id, input),
    onSuccess: (s, input) => {
      onDone(s);
      if (input.outcome === "CONFIRMED") toast.success(`${order.orderNumber} confirmed`);
      else if (input.outcome === "DECLINED") toast.success(`${order.orderNumber} cancelled — ${input.note}`);
      else if (s.escalatedAt) toast.warning(`${order.orderNumber} escalated — an owner or manager decides next`);
      else toast.success(s.callbackAt ? `Saved — call again ${formatStoreDateTime(s.callbackAt)}` : "Call saved");
    },
    onError,
  });
  const decide = useMutation({
    mutationFn: (input: Parameters<typeof adminOrdersApi.decideConfirmation>[1]) => adminOrdersApi.decideConfirmation(order.id, input),
    onSuccess: onDone,
    onError,
  });
  const release = useMutation({ mutationFn: () => adminOrdersApi.releaseConfirmation(order.id), onSuccess: onDone, onError });
  // Undo a callback set by mistake: the order goes back to Call now (the call itself stays in the history).
  const clearCallback = useMutation({
    mutationFn: () => adminOrdersApi.clearOrderHold(order.id),
    onSuccess: () => {
      invalidateOrderQueries(queryClient, order.id);
      void refetch();
    },
    onError,
  });

  if (!pending && !(state && state.attempts.length > 0)) return null;

  function choose(outcome: ConfirmationOutcome) {
    if (outcome === "CONFIRMED") return record.mutate({ outcome });
    if (UNREACHED_OUTCOMES.includes(outcome) || outcome === "WRONG_NUMBER") return record.mutate({ outcome });
    setDraft({ outcome, note: "", callbackAt: CALLBACK_OUTCOMES.includes(outcome) ? toDatetimeLocalValue(storeMorning(1).toISOString()) : "" });
  }

  const escalated = Boolean(state && (state.escalatedAt || state.staleEscalated));
  const claimedByOther = state?.claimedBy && !draft ? state.claimedBy : null;
  const busy = record.isPending || decide.isPending;

  return (
    <DetailSection title="Confirmation call" icon={PhoneCall} testId="order-call-panel">
      {isLoading ? (
        <div className="h-24 rounded-lg ui-skeleton" aria-hidden="true" />
      ) : isError || !state ? (
        <p className="text-sm text-danger-700">
          Couldn&apos;t load the calls.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <div className="space-y-3">
          <CallSummary state={state} pending={pending} onClear={perms.manage && !escalated ? () => clearCallback.mutate() : undefined} clearing={clearCallback.isPending} />

          {pending && claimedByOther && (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-info-50 px-3 py-2 text-sm text-info-800">
              <UserRound size={14} aria-hidden="true" /> {claimedByOther.name} is on this call
              {state.claimExpiresAt ? ` until ${formatStoreDateTime(state.claimExpiresAt)}` : ""}.
            </p>
          )}

          {pending && escalated && (
            <EscalationBox state={state} perms={perms} busy={busy} onDecide={(input) => decide.mutate(input)} onCancel={() => commands.requestStatusChange([order], "CANCELLED")} />
          )}

          {pending && perms.manage && !escalated && (
            <>
              <a
                href={`tel:${order.customerPhone}`}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[15px] font-semibold text-accent-fg transition-opacity hover:opacity-90"
              >
                <Phone size={18} aria-hidden="true" /> Call {order.customerPhone}
              </a>
              {draft ? (
                <DraftForm draft={draft} setDraft={setDraft} busy={busy} onSave={() => record.mutate({ outcome: draft.outcome, note: draft.note.trim() || undefined, callbackAt: draft.callbackAt ? new Date(draft.callbackAt).toISOString() : undefined })} />
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="What happened on the call?">
                  {OUTCOME_BUTTONS.filter((b) => b.outcome !== "DECLINED" || perms.cancel).map(({ outcome, icon: Icon, tone }) => (
                    <Button
                      key={outcome}
                      variant={tone === "primary" ? "primary" : "outline"}
                      className={cn("min-h-[44px] justify-center", tone === "danger" && "text-danger-700", outcome === "CONFIRMED" && "col-span-2 sm:col-span-1")}
                      disabled={busy || Boolean(claimedByOther)}
                      loading={record.isPending && record.variables?.outcome === outcome}
                      onClick={() => choose(outcome)}
                      data-outcome={outcome}
                    >
                      {Icon && <Icon size={15} aria-hidden="true" />} {CONFIRMATION_OUTCOME_LABELS[outcome]}
                    </Button>
                  ))}
                </div>
              )}
              {state.claimedBy && !claimedByOther && (
                <button type="button" className="text-xs text-fg-muted underline-offset-2 hover:underline" onClick={() => release.mutate()}>
                  Not calling now — let someone else take it
                </button>
              )}
            </>
          )}

          {pending && perms.manage && <AssignRow state={state} disabled={busy} onAssign={(assigneeId) => decide.mutate({ action: "assign", assigneeId })} />}

          <AttemptHistory state={state} />
        </div>
      )}
    </DetailSection>
  );
}

function CallSummary({ state, pending, onClear, clearing }: { state: OrderConfirmationState; pending: boolean; onClear?: () => void; clearing?: boolean }) {
  const due = state.callbackAt ? new Date(state.callbackAt) <= new Date() : false;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
      <span className="text-fg">
        {state.attempts.length === 0 ? "Not called yet" : `${state.attempts.length} call${state.attempts.length === 1 ? "" : "s"}`}
        <span className="text-fg-muted"> · {state.unreached} of {state.limit} unanswered</span>
      </span>
      {pending && state.callbackAt && (
        <span className={cn("tabular-nums", due ? "font-medium text-warning-800" : "text-fg-muted")} data-testid="call-callback">
          {due ? "Call now — due " : "Next call "}
          {formatStoreDateTime(state.callbackAt)}
          {onClear && (
            <button type="button" className="ml-2 text-xs text-fg-muted underline-offset-2 hover:underline disabled:opacity-50" disabled={clearing} onClick={onClear}>
              Clear callback
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function DraftForm({ draft, setDraft, busy, onSave }: { draft: Draft; setDraft: (d: Draft | null) => void; busy: boolean; onSave: () => void }) {
  const needsTime = CALLBACK_OUTCOMES.includes(draft.outcome);
  // Declined = the order is cancelled (the normal cancel transition, stock released there) — the reason is required.
  const needsNote = draft.outcome === "OTHER" || draft.outcome === "DECLINED";
  const picks = [
    { label: "+1 h", at: () => new Date(Date.now() + 3_600_000) },
    { label: "+3 h", at: () => new Date(Date.now() + 3 * 3_600_000) },
    { label: "Tomorrow 10:00", at: () => storeMorning(1) },
    { label: "Tomorrow 18:00", at: () => storeMorning(1, 18) },
  ];
  const ready = (!needsTime || draft.callbackAt) && (!needsNote || draft.note.trim().length >= 3);
  return (
    <div className="space-y-2.5 rounded-xl border border-line-subtle bg-surface-muted p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-fg">{CONFIRMATION_OUTCOME_LABELS[draft.outcome]}</p>
        <button type="button" aria-label="Back to outcomes" className="flex h-8 w-8 items-center justify-center rounded-full text-fg-muted hover:bg-ink-900/[0.05]" onClick={() => setDraft(null)}>
          <X size={16} />
        </button>
      </div>
      <div className={draft.outcome === "DECLINED" ? "hidden" : undefined}>
        {draft.outcome !== "DECLINED" && <p className="mb-1.5 text-xs font-medium text-fg-muted">{needsTime ? "When to call back" : "Call back (optional)"}</p>}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picks.map((p) => (
            <Button key={p.label} type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, callbackAt: toDatetimeLocalValue(p.at().toISOString()) })}>
              {p.label}
            </Button>
          ))}
        </div>
        <Input type="datetime-local" aria-label="Callback time" value={draft.callbackAt} onChange={(e) => setDraft({ ...draft, callbackAt: e.target.value })} />
      </div>
      <Textarea
        aria-label="Call note"
        rows={2}
        placeholder={draft.outcome === "DECLINED" ? "Why did the customer decline? (required — the order will be cancelled)" : needsNote ? "What happened? (required)" : "Note (optional) — e.g. asked to call after 6 pm"}
        value={draft.note}
        maxLength={500}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
      />
      <Button className="min-h-[44px] w-full" variant={draft.outcome === "DECLINED" ? "destructive" : "primary"} disabled={!ready || busy} loading={busy} onClick={onSave}>
        {draft.outcome === "DECLINED" ? "Cancel the order" : "Save call"}
      </Button>
    </div>
  );
}

function EscalationBox({
  state,
  perms,
  busy,
  onDecide,
  onCancel,
}: {
  state: OrderConfirmationState;
  perms: OrderPermissions;
  busy: boolean;
  onDecide: (input: { action: "retry"; reason: string } | { action: "phone_fixed"; reason: string }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const why = state.escalationReason ? CONFIRMATION_ESCALATION_LABELS[state.escalationReason] : CONFIRMATION_ESCALATION_LABELS.STALE;
  return (
    <div className="space-y-2.5 rounded-xl border border-warning-200 bg-warning-50 p-3" data-testid="call-escalated">
      <p className="flex items-start gap-2 text-sm text-warning-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium">Escalated — {why.toLowerCase()}.</span> Automatic callbacks have stopped. Nothing is cancelled unless a person
          decides to.
        </span>
      </p>
      {perms.escalations ? (
        <>
          <Input aria-label="Reason for the decision" placeholder="Reason (required) — e.g. customer messaged on Facebook" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || reason.trim().length < 3} onClick={() => onDecide({ action: "retry", reason: reason.trim() })}>
              One more try
            </Button>
            <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => onDecide({ action: "phone_fixed", reason: reason.trim() })}>
              Phone fixed
            </Button>
            {perms.cancel && (
              <Button size="sm" variant="outline" className="text-danger-700" disabled={busy} onClick={onCancel}>
                Cancel order…
              </Button>
            )}
          </div>
          <p className="text-xs text-warning-800/80">To fix the number, edit the customer&apos;s phone above — the unanswered count starts again.</p>
        </>
      ) : (
        <p className="text-xs text-warning-800">An owner or manager decides: one more try, a corrected phone, or cancelling with a reason.</p>
      )}
    </div>
  );
}

function AssignRow({ state, disabled, onAssign }: { state: OrderConfirmationState; disabled: boolean; onAssign: (id: string | null) => void }) {
  // The admin list is owner-only (users.manage): others see who it is assigned to, not the picker.
  const { data, isSuccess } = useQuery({ queryKey: ["admin-accounts"], queryFn: listAdmins, staleTime: 5 * 60_000, retry: false });
  const callers = (data?.admins ?? []).filter((a) => a.isActive);
  if (!isSuccess) return state.assignee ? <p className="text-xs text-fg-muted">Assigned to {state.assignee.name}</p> : null;
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      Assigned to
      <Select
        className="h-8 w-auto py-0 text-xs"
        value={state.assignee?.id ?? ""}
        disabled={disabled}
        onChange={(e) => onAssign(e.target.value || null)}
      >
        <option value="">Anyone</option>
        {callers.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function AttemptHistory({ state }: { state: OrderConfirmationState }) {
  if (state.attempts.length === 0) return null;
  return (
    <ol className="space-y-1.5 border-t border-line-subtle pt-2.5" aria-label="Call history">
      {state.attempts.map((a) => (
        <li key={a.id} className="text-xs leading-5" data-testid="call-attempt">
          <span className={cn("font-medium", a.outcome === "CONFIRMED" ? "text-success-700" : a.outcome === "DECLINED" || a.outcome === "WRONG_NUMBER" ? "text-danger-700" : "text-fg")}>
            {CONFIRMATION_OUTCOME_LABELS[a.outcome]}
          </span>
          <span className="text-fg-subtle">
            {" "}
            · {formatStoreDateTime(a.createdAt)}
            {a.admin ? ` · ${a.admin.name}` : ""}
            {a.callbackAt ? ` · call back ${formatStoreDateTime(a.callbackAt)}` : ""}
          </span>
          {a.note && <span className="block text-fg-muted">{a.note}</span>}
        </li>
      ))}
    </ol>
  );
}
