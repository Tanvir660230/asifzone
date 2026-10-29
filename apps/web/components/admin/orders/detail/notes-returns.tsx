"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Repeat, StickyNote, Wallet } from "lucide-react";
import type { Order } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approvalStatusBadgeVariant, formatPrice, formatStoreDate, orderStatusLabel } from "@/lib/format";
import type { OrderAttentionItem, OrderPermissions } from "../order-domain";
import { DetailSection } from "./detail-section";
import type { OrderDetailCommands } from "./use-order-detail-commands";

/** 8 — internal notes (never shown to the customer). */
export function NotesSection({ order, detail, perms }: { order: Order; detail: OrderDetailCommands; perms: OrderPermissions }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [order.id]);
  const value = draft ?? order.adminNotes ?? "";
  const editable = perms.manage && !order.deletedAt;

  return (
    <DetailSection title="Internal notes" icon={StickyNote} testId="order-notes">
      {editable ? (
        <div className="space-y-2">
          <Textarea
            rows={3}
            maxLength={2000}
            aria-label="Internal notes"
            placeholder="Only staff see this"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={draft === null || draft === (order.adminNotes ?? "")}
              loading={detail.details.isPending}
              onClick={() => detail.details.mutate({ adminNotes: value || null }, { onSuccess: () => setDraft(null) })}
            >
              Save notes
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-line text-sm text-ink-700">{order.adminNotes || <span className="text-ink-400">No internal notes.</span>}</p>
      )}
    </DetailSection>
  );
}

/** 9 — returns and exchanges on this order: the customer's requests, their review, and the replacement order an
 * approved exchange created. Reviewing happens on the Return Requests page (one review workflow). */
export function ReturnsSection({ order, perms }: { order: Order; perms: OrderPermissions }) {
  const requests = order.returnRequests ?? [];
  if (requests.length === 0) return null;
  return (
    <DetailSection
      title="Returns & exchanges"
      icon={Repeat}
      testId="order-returns"
      actions={
        perms.returns && requests.some((r) => r.status === "PENDING") ? (
          <Link href="/admin/return-requests?status=PENDING" className="inline-flex items-center gap-1 text-sm font-medium text-info-700 hover:underline">
            Review <ArrowRight size={13} aria-hidden="true" />
          </Link>
        ) : undefined
      }
    >
      <ul className="space-y-3">
        {requests.map((r) => (
          <li key={r.id} className="rounded-xl border border-line-subtle p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink-900">{r.type === "EXCHANGE" ? "Exchange" : "Return"}</span>
              <Badge variant={approvalStatusBadgeVariant(r.status)} dot>
                {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
              </Badge>
              <span className="ml-auto text-xs text-ink-400">{formatStoreDate(r.createdAt)}</span>
            </div>
            <p className="mt-1 text-ink-700">{r.reason}</p>
            {r.note && <p className="text-xs text-ink-500">{r.note}</p>}
            {r.type === "EXCHANGE" && r.originalSizeSnapshot && (
              <p className="mt-1 text-xs text-ink-500">
                {r.originalSizeSnapshot}/{r.originalColorSnapshot} → {r.requestedSizeSnapshot}/{r.requestedColorSnapshot}
              </p>
            )}
            {r.lines && r.lines.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-ink-600" aria-label="Returned units">
                {r.lines.map((l) => (
                  <li key={l.orderItemId}>
                    {l.productName} {[l.size, l.color].filter(Boolean).join(" / ")} ×{l.quantity}
                    {l.writtenOff > 0 ? ` (${l.restocked} restocked, ${l.writtenOff} written off)` : " (restocked)"} · {formatPrice(l.value)}
                  </li>
                ))}
              </ul>
            )}
            {r.compensation && r.compensation !== "NONE" && Number(r.compensationAmount ?? 0) > 0 && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-ink-800">
                <Wallet size={12} aria-hidden="true" />
                {r.compensation === "STORE_CREDIT" ? "Store credit" : "Refund owed"} {formatPrice(Number(r.compensationAmount))}
              </p>
            )}
            {r.adminNote && <p className="mt-1.5 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-ink-700">Staff note: {r.adminNote}</p>}
            {r.exchangeOrder && (
              <p className="mt-1.5 text-xs">
                Replacement order{" "}
                <Link href={`/admin/orders/${r.exchangeOrder.id}`} className="font-medium text-info-700 hover:underline">
                  {r.exchangeOrder.orderNumber}
                </Link>{" "}
                · {orderStatusLabel(r.exchangeOrder.status)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}

/** 10 — what needs attention, surfaced at the top of the detail (from `orderAttention`, server facts only). */
export function AttentionPanel({ items }: { items: OrderAttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2" aria-label="Needs attention" role="region" data-testid="order-attention">
      {items.map((item) => (
        <Alert key={item.key} variant={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "info"} title={item.label}>
          {item.detail}
        </Alert>
      ))}
    </div>
  );
}
