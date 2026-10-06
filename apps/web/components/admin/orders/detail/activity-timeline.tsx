"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  CircleDollarSign,
  CreditCard,
  History,
  Link2,
  MessageSquareText,
  PenLine,
  RotateCcw,
  Truck,
  Undo2,
  User,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Order, OrderModificationRecord, PaymentLinkDto } from "@clothing-brand/shared";
import { SegmentedControl } from "@/components/ui/tabs";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import * as paymentsAdminApi from "@/lib/api/payments-admin";
import { formatPrice, formatStoreDateTime, orderStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { orderKeys } from "../order-domain";
import { useOrderModifications } from "./changes-section";
import { DetailSection } from "./detail-section";

type Kind = "status" | "money" | "courier" | "returns" | "changes";
/** The financial concept an event belongs to — shown as a label next to it, so Payment, Refund, Store Credit and Payment
 * Link are never confused (docs/ORDER_ADJUSTMENTS.md §5). */
type Concept = "Payment" | "Refund" | "Store credit" | "Payment link" | "Order change" | "Return";

interface Event {
  key: string;
  at: string;
  kind: Kind;
  concept?: Concept;
  title: string;
  note?: string | null;
  /** Who did it: an admin's name, or null for the system / customer / courier / gateway. */
  actor: string | null;
  actorLabel?: string;
  icon: LucideIcon | { status: Order["status"] };
  tone?: "danger" | "success" | "warning" | "info";
}

/**
 * Status-history notes that only restate a record this timeline already shows from its own table (a payment, refund,
 * credit, change, link or item return — the API writes such a note next to each). They are folded in rather than shown
 * twice; a note whose record isn't shown here (e.g. "Payment link sent by SMS") stays.
 */
const RESTATED_NOTE_PREFIXES = [
  "Payment recorded:",
  "Refund recorded:",
  "Refund requested:",
  "Refund paid out:",
  "Store credit:",
  "Order modified (#",
  "Change #",
  "Payment link created",
  "Payment link cancelled",
  "Items returned:",
];
const restates = (note: string | null) => Boolean(note && (RESTATED_NOTE_PREFIXES.some((p) => note.startsWith(p)) || /^Paid .+ from store balance/.test(note)));

const CHANGE_STATUS: Record<OrderModificationRecord["status"], string> = {
  APPLIED: "applied",
  AWAITING_PAYMENT: "waiting for payment",
  SUPERSEDED: "replaced by a newer change",
  CANCELLED: "not applied",
  EXPIRED: "expired unpaid",
};

/** Every event recorded about the order, from the records that hold it — status history, the payment ledger (payments,
 * refunds, store credit), order changes, payment links and their attempts, the courier booking and loss ledger, returns.
 * Nothing is inferred: an entry exists only where a row does, and "System" means no admin is recorded on it. */
function buildEvents(order: Order, mods: OrderModificationRecord[], links: PaymentLinkDto[]): Event[] {
  const events: Event[] = [];
  order.statusHistory.forEach((h, i) => {
    const prev = order.statusHistory[i - 1];
    const isChange = !prev || prev.status !== h.status;
    if (!isChange && restates(h.note)) return;
    events.push({
      key: `h-${h.id}`,
      at: h.createdAt,
      kind: "status",
      title: i === 0 ? `Order placed · ${orderStatusLabel(h.status)}` : isChange ? `Status → ${orderStatusLabel(h.status)}` : "Note / update",
      note: h.note,
      actor: h.changedByAdmin?.name ?? null,
      icon: isChange ? { status: h.status } : MessageSquareText,
    });
  });
  for (const p of order.payment?.payments ?? []) {
    const credit = p.provider === "STORE_CREDIT";
    events.push({
      key: `p-${p.id}`,
      at: p.settledAt,
      kind: "money",
      concept: credit ? "Store credit" : "Payment",
      title: p.status !== "SUCCEEDED" ? `Payment attempt failed · ${formatPrice(p.amount)}` : credit ? `Paid from Store Balance · ${formatPrice(p.amount)}` : `Payment received · ${formatPrice(p.amount)}`,
      note: p.note,
      actor: p.recordedBy,
      actorLabel: p.provider === "MANUAL" ? undefined : p.provider === "COD" ? "Courier (COD)" : credit ? "Customer" : "Payment gateway",
      icon: p.status !== "SUCCEEDED" ? XCircle : credit ? Wallet : CircleDollarSign,
      tone: p.status === "SUCCEEDED" ? "success" : "danger",
    });
  }
  for (const r of order.payment?.refunds ?? []) {
    events.push({ key: `r-${r.id}`, at: r.createdAt, kind: "money", concept: "Refund", title: `Refund ${r.status === "REQUESTED" ? "owed" : "recorded"} · ${formatPrice(r.amount)}`, note: r.reason, actor: r.requestedBy, icon: RotateCcw });
    if (r.completedAt && r.status === "COMPLETED" && r.completedBy && r.completedBy !== r.requestedBy) {
      events.push({ key: `rc-${r.id}`, at: r.completedAt, kind: "money", concept: "Refund", title: `Refund paid out · ${formatPrice(r.amount)}`, actor: r.completedBy, icon: RotateCcw });
    }
  }
  for (const c of order.payment?.credits ?? []) {
    events.push({ key: `c-${c.id}`, at: c.createdAt, kind: "money", concept: "Store credit", title: `Store credit issued · +${formatPrice(c.amount)}`, note: c.reason, actor: c.createdBy, icon: Wallet, tone: "info" });
  }
  for (const m of mods) {
    events.push({
      key: `m-${m.id}`,
      at: m.createdAt,
      kind: "changes",
      concept: "Order change",
      title: `Order change #${m.sequence} · ${formatPrice(m.previousTotal)} → ${formatPrice(m.newTotal)} · ${CHANGE_STATUS[m.status]}`,
      note: [
        m.amountDue > 0 ? `${formatPrice(m.amountDue)} ${m.status === "APPLIED" ? "due" : "to pay"}` : null,
        m.amountCredited > 0 ? `+${formatPrice(m.amountCredited)} to Store Balance` : null,
        m.reason,
        m.statusReason,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      actor: m.by && m.initiatedBy === "ADMIN" ? m.by : null,
      actorLabel: m.initiatedBy === "CUSTOMER" ? "Customer" : undefined,
      icon: PenLine,
      tone: m.status === "AWAITING_PAYMENT" ? "warning" : undefined,
    });
  }
  for (const l of links) {
    const what = l.purpose === "MODIFICATION" ? "for an order change" : "for the balance due";
    events.push({ key: `l-${l.id}`, at: l.createdAt, kind: "money", concept: "Payment link", title: `Payment link created · ${formatPrice(l.amount)} ${what}`, actor: l.createdBy, icon: Link2 });
    for (const a of l.attempts) {
      events.push({
        key: `la-${a.id}`,
        at: a.createdAt,
        kind: "money",
        concept: "Payment link",
        title: `Payment attempt via link · ${a.provider} · ${a.status.toLowerCase()}${a.amount !== null ? ` · ${formatPrice(a.amount)}` : ""}`,
        actor: null,
        actorLabel: "Customer",
        icon: CreditCard,
      });
    }
    if (l.usedAt) events.push({ key: `lu-${l.id}`, at: l.usedAt, kind: "money", concept: "Payment link", title: "Payment link used — paid", actor: null, actorLabel: "Payment gateway", icon: Link2, tone: "success" });
    if (l.cancelledAt) events.push({ key: `lc-${l.id}`, at: l.cancelledAt, kind: "money", concept: "Payment link", title: "Payment link cancelled", note: l.statusReason, actor: null, icon: Link2 });
    if (l.status === "EXPIRED") events.push({ key: `le-${l.id}`, at: l.expiresAt, kind: "money", concept: "Payment link", title: "Payment link expired", note: l.statusReason, actor: null, icon: Link2 });
  }
  if (order.courierBookedAt) {
    events.push({ key: "booked", at: order.courierBookedAt, kind: "courier", title: "Booked with the courier", note: order.courierConsignmentId, actor: null, actorLabel: "Courier", icon: Truck });
  }
  for (const l of order.courierLosses ?? []) {
    events.push({
      key: `cl-${l.id}`,
      at: l.createdAt,
      kind: "courier",
      title: `Courier loss logged · ${formatPrice(l.amount)}`,
      note: l.reason === "PARTIAL_RETURN" ? "Partial return" : "Cancelled after booking",
      actor: null,
      icon: Truck,
      tone: "danger",
    });
  }
  for (const rr of order.returnRequests ?? []) {
    if (rr.lines && rr.lines.length > 0) {
      // Recorded by staff in one step (item-level return): one event with what came back.
      events.push({
        key: `ir-${rr.id}`,
        at: rr.createdAt,
        kind: "returns",
        concept: "Return",
        title: `Items returned · ${rr.lines.reduce((n, l) => n + l.quantity, 0)} unit(s) · ${formatPrice(rr.lines.reduce((n, l) => n + l.value, 0))}`,
        note: [rr.lines.map((l) => `${l.productName} ×${l.quantity}${l.writtenOff ? ` (${l.writtenOff} written off)` : ""}`).join(", "), rr.reason].join(" — "),
        actor: null,
        actorLabel: "Staff",
        icon: Undo2,
      });
      continue;
    }
    const label = rr.type === "EXCHANGE" ? "Exchange" : "Return";
    events.push({ key: `rr-${rr.id}`, at: rr.createdAt, kind: "returns", concept: "Return", title: `${label} requested`, note: [rr.reason, rr.note].filter(Boolean).join(" — "), actor: null, actorLabel: "Customer", icon: RotateCcw });
    if (rr.reviewedAt) {
      events.push({
        key: `rv-${rr.id}`,
        at: rr.reviewedAt,
        kind: "returns",
        concept: "Return",
        title: `${label} ${rr.status.toLowerCase()}${rr.exchangeOrder ? ` · replacement ${rr.exchangeOrder.orderNumber}` : ""}`,
        note: rr.adminNote,
        actor: null,
        actorLabel: "Staff review",
        icon: RotateCcw,
      });
    }
  }
  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "status", label: "Status" },
  { value: "money", label: "Money" },
  { value: "changes", label: "Changes" },
  { value: "courier", label: "Courier" },
] as const;

const TONE: Record<NonNullable<Event["tone"]>, string> = {
  danger: "bg-danger-50 text-danger-600",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  info: "bg-info-50 text-info-700",
};

/** 6 — the audit trail, money included: who, when, and which financial concept. */
export function ActivityTimeline({ order }: { order: Order }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const { data: modsData } = useOrderModifications(order.id);
  const { data: linksData } = useQuery({ queryKey: orderKeys.paymentLinks(order.id), queryFn: () => paymentsAdminApi.listPaymentLinks(order.id) });
  const all = useMemo(() => buildEvents(order, modsData?.modifications ?? [], linksData?.links ?? []), [order, modsData, linksData]);
  const events =
    filter === "all" ? all : all.filter((e) => e.kind === filter || (filter === "status" && e.kind === "returns") || (filter === "changes" && e.kind === "returns"));

  return (
    <DetailSection
      title="Activity"
      icon={History}
      testId="order-timeline"
      actions={<SegmentedControl aria-label="Filter activity" value={filter} onChange={setFilter} options={FILTERS} className="hidden sm:inline-flex" />}
    >
      {events.length === 0 ? (
        <p className="text-sm text-ink-500">Nothing recorded for this filter.</p>
      ) : (
        <ol className="space-y-0">
          {events.map((e, i) => {
            const isAdmin = Boolean(e.actor);
            return (
              <li key={e.key} className="flex gap-3" data-concept={e.concept}>
                <div className="flex flex-col items-center">
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", e.tone ? TONE[e.tone] : "bg-ink-100 text-ink-600")} aria-hidden="true">
                    {"status" in e.icon ? <OrderStatusIcon status={e.icon.status} size={13} /> : <e.icon size={13} />}
                  </span>
                  {i < events.length - 1 && <span className="my-1 w-px flex-1 bg-line-subtle" aria-hidden="true" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="text-sm font-medium text-ink-900">
                      {e.concept && <span className="mr-1.5 rounded-md border border-line px-1.5 py-px text-[11px] font-medium uppercase tracking-wide text-ink-500">{e.concept}</span>}
                      {e.title}
                    </p>
                    <time dateTime={e.at} className="text-xs tabular-nums text-ink-400">
                      {formatStoreDateTime(e.at)}
                    </time>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                    {isAdmin ? <User size={11} aria-hidden="true" /> : <Bot size={11} aria-hidden="true" />}
                    {isAdmin ? e.actor : (e.actorLabel ?? "System")}
                    <span className="sr-only">{isAdmin ? "(admin action)" : "(automatic)"}</span>
                  </p>
                  {e.note && <p className="mt-1.5 whitespace-pre-line break-words rounded-lg bg-surface-muted px-2.5 py-1.5 text-sm text-ink-700">{e.note}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </DetailSection>
  );
}
