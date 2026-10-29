"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/api-client";
import * as financeApi from "@/lib/api/finance";
import type { ShareAdjustment, SharePeriod } from "@/lib/api/finance";
import { formatBookDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Sharing a month's profit with partners, the way the books allow it (partner finance plan §7): a month is shared only
 * once it is closed in the books, prepared (its month-end blockers checked), and verified by the owner typing its profit;
 * then it is posted once. Corrections to months already shared are listed for a decision.
 */
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const signed = (v: number) => (v < 0 ? `−${formatPrice(-v)}` : formatPrice(v));

type Stage = { label: string; variant: "neutral" | "success" | "warning" | "danger" | "info" };
function stageOf(m: SharePeriod): Stage {
  if (m.status === "POSTED") return { label: "Shared", variant: "success" }; // (months shared before these rules may still be open)
  if (m.status === "POSTING_FAILED") return { label: "Not in the books — retry", variant: "danger" };
  if (m.status === "RESTATEMENT_WATCH") return { label: "Reopened — check again", variant: "warning" };
  if (m.accountingStatus !== "CLOSED") return { label: "Month not closed", variant: "neutral" };
  if (!m.status) return { label: "Ready to prepare", variant: "info" };
  if (m.status === "PREPARED") return m.blocked ? { label: "Steps to finish", variant: "warning" } : { label: "Waiting for your check", variant: "info" };
  return { label: "Verified — ready to share", variant: "info" };
}

export function MonthlySharing() {
  const q = useQuery({ queryKey: financeApi.sharePeriodKeys.all(), queryFn: financeApi.getSharePeriods });
  const months = q.data?.months ?? [];
  const needs = months.filter((m) => m.status !== "POSTED");
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? months : needs.slice(0, 4);
  return (
    <Card className="p-0" data-testid="monthly-sharing">
      <div className="space-y-1 px-5 pt-5 sm:px-6">
        <p className="text-[17px] font-semibold tracking-tight text-fg">Sharing each month&apos;s profit</p>
        <p className="text-sm text-fg-muted">A month is shared once it is closed in the books and you have checked its profit. Then each partner&apos;s share is posted once, at that month&apos;s rate.</p>
      </div>
      {q.isLoading ? <div className="p-5 sm:p-6"><Skeleton className="h-24 w-full" /></div>
        : q.isError ? <div className="p-5 sm:p-6"><Alert variant="danger" title="Couldn't load the months" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert></div>
        : months.length === 0 ? <p className="px-5 py-4 text-sm text-fg-muted sm:px-6">No finished months since the books started.</p>
        : (
          <>
            {!showAll && needs.length === 0 && (
              <p className="flex items-center gap-2 px-5 py-4 text-sm text-fg-muted sm:px-6"><CheckCircle2 className="h-4 w-4 text-success-600" /> Every finished month is shared.</p>
            )}
            <ul className="mt-3 divide-y divide-line-subtle border-t border-line-subtle">
              {shown.map((m) => <MonthRow key={m.period} m={m} />)}
            </ul>
            {months.length > shown.length || showAll ? (
              <div className="px-5 py-3 sm:px-6"><Button size="sm" variant="ghost" className="-ml-3" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show only what needs you" : `Show all ${months.length} months`}</Button></div>
            ) : null}
          </>
        )}
    </Card>
  );
}

function MonthRow({ m }: { m: SharePeriod }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const stage = stageOf(m);
  const act = useMutation({
    mutationFn: (a: { action: "prepare" | "verify" | "post" | "retry"; body?: Record<string, unknown> }) => financeApi.sharePeriodAction(m.period, a.action, a.body),
    onSuccess: (r, a) => {
      void qc.invalidateQueries({ queryKey: ["finance"] });
      if (a.action === "post") toast.success(r.status === "POSTED" ? `${monthLabel(m.period)} shared` : `${monthLabel(m.period)}: some shares didn't reach the books — retry`);
      else if (a.action === "verify") toast.success(r.status === "POSTED" ? "Checked again — any difference is listed under corrections" : "Checked — ready to share");
      else if (a.action === "retry") toast.success(r.status === "POSTED" ? "In the books" : "Still not in the books");
      setTyped("");
    },
    onError: (e) => toast.error(getErrorMessage(e, "That didn't work")),
  });
  const blockers = (m.readiness.steps ?? []).filter((s) => s.blocking && s.status === "TODO");
  const others = (m.readiness.steps ?? []).filter((s) => !s.blocking && s.status === "TODO");
  const n = Number(typed);
  const canVerify = m.status === "PREPARED" && !m.blocked && m.netProfit !== null && typed.trim() !== "" && Math.round(n * 100) === Math.round(m.netProfit * 100);
  const restatement = Boolean(m.readiness.restatement);
  return (
    <li className="px-5 py-3.5 sm:px-6">
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-fg">{monthLabel(m.period)}</span>
          <span className="text-xs text-fg-muted">{m.netProfit === null ? "Profit known once prepared" : `${m.netProfit < 0 ? "Loss" : "Profit"} ${formatPrice(Math.abs(m.netProfit))}`}{m.postedAt && m.status === "POSTED" ? ` · shared ${formatBookDate(m.postedAt.slice(0, 10))}` : ""}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2"><Badge variant={stage.variant} dot>{stage.label}</Badge><ChevronDown className={cn("h-4 w-4 text-fg-muted transition-transform", open && "rotate-180")} /></span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {m.accountingStatus !== "CLOSED" && m.status !== "POSTED" && (
            <p className="text-fg-muted">Close {monthLabel(m.period)} in the books first — then nothing more can change its profit. <Link className="font-medium text-fg underline underline-offset-2" href={`/admin/finance/month-end?month=${m.period}`}>Month-end checklist</Link></p>
          )}
          {blockers.length > 0 && (
            <Alert variant="warning" title="Finish these before sharing">
              <ul className="list-disc pl-4">{blockers.map((s) => <li key={s.key}><Link href={s.href} className="underline underline-offset-2">{s.label}</Link> — {s.detail}</li>)}</ul>
            </Alert>
          )}
          {others.length > 0 && <p className="text-xs text-fg-muted">Also open (doesn&apos;t stop sharing): {others.map((s) => s.label.toLowerCase()).join(", ")}.</p>}
          {m.status === "PREPARED" && !m.blocked && (m.readiness.shares?.length ?? 0) > 0 && (
            <ul className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
              {m.readiness.shares!.map((s) => <li key={s.partnerId} className="flex justify-between gap-3 px-3 py-2"><span>{s.name} · {s.pct}%</span><span className="tabular-nums font-medium">{formatPrice(s.share)}</span></li>)}
            </ul>
          )}
          {m.status === "POSTING_FAILED" && m.lastError && <Alert variant="danger" title="A share didn't reach the books">{m.lastError}</Alert>}
          <div className="flex flex-wrap items-end gap-2">
            {m.accountingStatus === "CLOSED" && (!m.status || m.status === "RESTATEMENT_WATCH" || (m.status === "PREPARED" && m.blocked)) && (
              <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "prepare" })} data-testid={`prepare-${m.period}`}>{m.status === "PREPARED" ? "Check again" : "Prepare"}</Button>
            )}
            {m.status === "PREPARED" && !m.blocked && m.netProfit !== null && (
              <>
                <Field htmlFor={`confirm-${m.period}`} label={`Type the month's ${m.netProfit < 0 ? "loss as a negative number" : "profit"} to confirm`} hint={signed(m.netProfit)}>
                  <Input id={`confirm-${m.period}`} inputMode="decimal" value={typed} onChange={(e) => setTyped(e.target.value)} className="w-40" />
                </Field>
                <Button size="sm" disabled={!canVerify} loading={act.isPending} onClick={() => act.mutate({ action: "verify", body: { confirmProfit: n } })} data-testid={`verify-${m.period}`}>{restatement ? "Confirm checked again" : "Confirm profit"}</Button>
              </>
            )}
            {m.status === "VERIFIED" && <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ action: "post" })} data-testid={`post-${m.period}`}>Share {monthLabel(m.period)}</Button>}
            {m.status === "POSTING_FAILED" && <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate({ action: "retry" })}>Retry</Button>}
          </div>
        </div>
      )}
    </li>
  );
}

// ── corrections ───────────────────────────────────────────────────────────────────────────────────────────────────────

const KIND: Record<ShareAdjustment["kind"], string> = {
  PROFIT_RESTATEMENT_UP: "Profit turned out higher",
  PROFIT_RESTATEMENT_DOWN: "Profit turned out lower",
  DUPLICATE_POSTING: "Posted twice",
  INVALID_POSTING: "Posted by mistake",
};

export function Corrections({ partnerNames }: { partnerNames: Map<string, string> }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: financeApi.sharePeriodKeys.adjustments(), queryFn: financeApi.getAdjustments });
  const [rejecting, setRejecting] = useState<ShareAdjustment | null>(null);
  const detect = useMutation({
    mutationFn: financeApi.detectAdjustments,
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success(r.adjustments.length ? `${r.adjustments.length} new to look at` : "No shared month has changed"); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't check")),
  });
  const approve = useMutation({
    mutationFn: (id: string) => financeApi.decideAdjustment(id, "approve"),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success("Correction made"); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't make the correction")),
  });
  const all = q.data?.adjustments ?? [];
  const open = all.filter((a) => a.status === "PROPOSED" || a.status === "POLICY_REVIEW");
  const done = all.filter((a) => a.status === "POSTED" || a.status === "REJECTED").slice(0, 5);
  return (
    <Card className="p-0" data-testid="share-corrections">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-[17px] font-semibold tracking-tight text-fg">Corrections</p>
          <p className="text-sm text-fg-muted">When a shared month&apos;s profit changes, or a share was posted twice or by mistake. A share is never edited — and nothing is taken back without an accounting decision.</p>
        </div>
        <Button size="sm" variant="outline" loading={detect.isPending} onClick={() => detect.mutate()}>Check shared months</Button>
      </div>
      {q.isLoading ? <div className="p-5 sm:p-6"><Skeleton className="h-16 w-full" /></div>
        : q.isError ? <div className="p-5 sm:p-6"><Alert variant="danger" title="Couldn't load corrections" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert></div>
        : (
          <ul className="mt-3 divide-y divide-line-subtle border-t border-line-subtle text-sm">
            {open.length === 0 && done.length === 0 && <li className="px-5 py-4 text-fg-muted sm:px-6">Nothing to correct.</li>}
            {[...open, ...done].map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 sm:px-6">
                <span className="min-w-0">
                  <span className="block font-medium text-fg">{partnerNames.get(a.partnerId) ?? "Partner"} · {monthLabel(a.period)} · {KIND[a.kind]}</span>
                  <span className="text-xs text-fg-muted">
                    {a.profitThen !== null && a.profitNow !== null ? `Profit ${signed(a.profitThen)} → ${signed(a.profitNow)} at ${a.sharePct}%. ` : ""}
                    {a.status === "POLICY_REVIEW" ? "Would take money back from the partner — needs an accounting decision, not an approval." : a.reason}
                    {a.status === "REJECTED" && a.rejectionReason ? ` Rejected: ${a.rejectionReason}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={cn("tabular-nums font-medium", a.amount < 0 ? "text-fg" : "text-success-700")}>{a.amount < 0 ? "−" : "+"}{formatPrice(Math.abs(a.amount))}</span>
                  {a.status === "PROPOSED" && <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate(a.id)}>Approve</Button>}
                  {(a.status === "PROPOSED" || a.status === "POLICY_REVIEW") && <Button size="sm" variant="ghost" onClick={() => setRejecting(a)}>Reject</Button>}
                  {a.status === "POSTED" && <Badge variant="success">Done</Badge>}
                  {a.status === "REJECTED" && <Badge variant="neutral">Rejected</Badge>}
                  {a.status === "POLICY_REVIEW" && <Badge variant="warning">Decision needed</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      {rejecting && <RejectModal adjustment={rejecting} onClose={() => setRejecting(null)} />}
    </Card>
  );
}

function RejectModal({ adjustment, onClose }: { adjustment: ShareAdjustment; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () => financeApi.decideAdjustment(adjustment.id, "reject", reason.trim()),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["finance"] }); toast.success("Rejected"); onClose(); },
    onError: (e) => toast.error(getErrorMessage(e, "Couldn't reject")),
  });
  return (
    <Modal open onClose={onClose} title="Reject this correction" widthClassName="max-w-md" description="Nothing is posted. The reason is kept."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Reject</Button></>}>
      <Field htmlFor="adj-reason" label="Reason" required><Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus /></Field>
    </Modal>
  );
}

// ── statement ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const CLASS_LABEL: Record<string, string> = {
  SHARE: "Profit share", SHARE_REVERSAL: "Share reversed", SHARE_CORRECTION: "Share correction", SHARE_CORRECTION_REVERSAL: "Correction reversed",
  PAYMENT: "Paid", PAYMENT_REVERSAL: "Payment reversed", PARTNER_DEPOSIT: "Received from partner", PARTNER_DEPOSIT_REVERSAL: "Receipt reversed",
  CAPITAL_IN: "Capital put in", CAPITAL_IN_REVERSAL: "Capital reversed", CAPITAL_OUT: "Capital returned", CAPITAL_OUT_REVERSAL: "Return reversed",
  OPENING: "Opening balance", UNCLASSIFIED: "Other entry — needs a look",
};

/** Every line on a partner's account in date order, with the running balance, and the check that it equals the books. */
export function StatementModal({ partnerId, name, onClose }: { partnerId: string; name: string; onClose: () => void }) {
  const q = useQuery({ queryKey: financeApi.sharePeriodKeys.statement(partnerId), queryFn: () => financeApi.getPartnerStatement(partnerId) });
  const s = q.data?.current;
  return (
    <Modal open onClose={onClose} title={`${name} — statement`} widthClassName="max-w-2xl"
      description={q.data ? `${formatBookDate(q.data.from)} to ${formatBookDate(q.data.to)} · what the business owes ${name}` : undefined}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}>
      {q.isLoading ? <Skeleton className="h-40 w-full" />
        : q.isError ? <Alert variant="danger" title="Couldn't load the statement" action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>}>{getErrorMessage(q.error, "")}</Alert>
        : s && (
          <div className="space-y-3 text-sm">
            {s.reconciled
              ? <p className="flex items-center gap-2 text-success-700"><CheckCircle2 className="h-4 w-4" /> Matches the books to the paisa</p>
              : <Alert variant="danger" title="Doesn't match the books">Off by {signed(s.difference)} — don&apos;t pay until it is looked into.</Alert>}
            <div className="flex justify-between border-b border-line-subtle pb-2 text-fg-muted"><span>Opening</span><span className="tabular-nums">{signed(s.opening)}</span></div>
            {s.lines.length === 0 ? <p className="text-fg-muted">Nothing in this period.</p> : (
              <ul className="divide-y divide-line-subtle">
                {s.lines.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-fg">{CLASS_LABEL[l.class] ?? l.class}{l.advance ? " (advance)" : ""}</span>
                      <span className="text-xs text-fg-muted">{formatBookDate(l.date)}{l.journalNumber ? ` · journal ${l.journalNumber}` : ""} · {l.description}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn("block tabular-nums font-medium", l.amount >= 0 ? "text-success-700" : "text-fg")}>{l.amount >= 0 ? "+" : "−"}{formatPrice(Math.abs(l.amount))}</span>
                      <span className="text-xs tabular-nums text-fg-muted">{signed(l.balanceAfter)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-between border-t border-line-subtle pt-2 font-medium text-fg"><span>Closing</span><span className="tabular-nums">{signed(s.closing)}</span></div>
          </div>
        )}
    </Modal>
  );
}
