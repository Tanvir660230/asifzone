"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard, PenLine, Undo2, Wallet } from "lucide-react";
import { itemReturnBlocker, orderModificationBlocker, type Order, type OrderModificationRecord } from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import * as adjustmentsApi from "@/lib/api/admin-order-adjustments";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { orderKeys, type OrderPermissions } from "../order-domain";
import { BlockedHint, DetailSection } from "./detail-section";

const STATUS: Record<OrderModificationRecord["status"], { label: string; variant: "success" | "warning" | "neutral" | "danger" }> = {
  APPLIED: { label: "Applied", variant: "success" },
  AWAITING_PAYMENT: { label: "Waiting for payment", variant: "warning" },
  SUPERSEDED: { label: "Replaced", variant: "neutral" },
  CANCELLED: { label: "Not applied", variant: "danger" },
  EXPIRED: { label: "Expired", variant: "neutral" },
};

export function useOrderModifications(orderId: string) {
  return useQuery({ queryKey: orderKeys.modifications(orderId), queryFn: () => adjustmentsApi.listOrderModifications(orderId) });
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Changes to the order after it was placed — "Change order" and "Record return" entry points, a change waiting for its
 * difference, and the full change history with what each did to the money. Eligibility comes from the shared guards the
 * API applies (orderModificationBlocker / itemReturnBlocker); the server re-checks on every request.
 */
export function ChangesSection({
  order,
  perms,
  onModify,
  onReturn,
}: {
  order: Order;
  perms: OrderPermissions;
  onModify: () => void;
  onReturn: () => void;
}) {
  const { data } = useOrderModifications(order.id);
  const mods = data?.modifications ?? [];
  const waiting = mods.find((m) => m.status === "AWAITING_PAYMENT");
  const modifyBlocker = orderModificationBlocker(order, "ADMIN");
  const returnBlocker = itemReturnBlocker(order);
  const showModify = perms.manage && !order.deletedAt;
  const showReturn = perms.returns && !returnBlocker;

  if (!showModify && !showReturn && mods.length === 0) return null;

  return (
    <DetailSection
      title="Changes & returns"
      icon={PenLine}
      testId="order-changes"
      actions={
        <div className="flex flex-wrap gap-2">
          {showModify && !modifyBlocker && (
            <Button size="sm" variant="outline" onClick={onModify} data-testid="open-change-order">
              <PenLine size={14} aria-hidden="true" /> Change order
            </Button>
          )}
          {showReturn && (
            <Button size="sm" variant="outline" onClick={onReturn} data-testid="open-item-return">
              <Undo2 size={14} aria-hidden="true" /> Record return
            </Button>
          )}
        </div>
      }
    >
      {showModify && modifyBlocker && returnBlocker && !order.deletedAt && <BlockedHint>Items can&apos;t be changed: {lower(modifyBlocker)}.</BlockedHint>}

      {waiting && (
        <div className="mb-3 flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm" data-testid="waiting-change">
          <CreditCard size={18} className="mt-0.5 shrink-0 text-warning-700" aria-hidden="true" />
          <div>
            <p className="font-medium text-ink-900">Change #{waiting.sequence} is waiting for {formatPrice(waiting.amountDue)}</p>
            <p className="text-ink-600">
              Total {formatPrice(waiting.previousTotal)} → {formatPrice(waiting.newTotal)}. It applies automatically once the customer pays — send a payment link for exactly this
              amount from Payments.
              {waiting.expiresAt && ` Payable until ${formatStoreDateTime(waiting.expiresAt)}.`}
            </p>
          </div>
        </div>
      )}

      {mods.length === 0 ? (
        <p className="text-sm text-ink-500">No changes since the order was placed.</p>
      ) : (
        <ol className="space-y-2" aria-label="Change history">
          {mods.map((m) => (
            <li key={m.id} className="rounded-xl border border-line-subtle p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink-900">Change #{m.sequence}</span>
                <Badge variant={STATUS[m.status].variant} dot>
                  {STATUS[m.status].label}
                </Badge>
                <span className="ml-auto text-xs text-ink-400">{formatStoreDateTime(m.appliedAt ?? m.createdAt)}</span>
              </div>
              <p className="mt-1 tabular-nums text-ink-700">
                {formatPrice(m.previousTotal)} → {formatPrice(m.newTotal)}
                {m.amountCredited > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-success-700">
                    <Wallet size={12} aria-hidden="true" /> +{formatPrice(m.amountCredited)} Store Balance
                  </span>
                )}
                {m.amountDue > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-warning-700">
                    <CreditCard size={12} aria-hidden="true" /> {formatPrice(m.amountDue)} {m.status === "APPLIED" ? "due" : "to pay"}
                  </span>
                )}
              </p>
              <p className="text-xs text-ink-500">
                By {m.by ?? (m.initiatedBy === "CUSTOMER" ? "the customer" : "staff")}
                {m.statusReason ? ` · ${m.statusReason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}
