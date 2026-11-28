"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, MessageSquareWarning } from "lucide-react";
import {
  EXCHANGE_OUR_FAULT,
  EXCHANGE_REASON_LABEL,
  EXCHANGE_REASONS,
  ISSUE_CHANNELS,
  ORDER_ISSUE_KINDS,
  ORDER_ISSUE_LABEL,
  type ExchangeReasonValue,
  type IssueChannelValue,
  type Order,
  type OrderIssueKindValue,
  type SwapStatusValue,
} from "@clothing-brand/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import * as api from "@/lib/api/door-swap";
import { getProductBySlug } from "@/lib/api/storefront";
import { formatPrice, formatStoreDateTime } from "@/lib/format";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { VariantChooser } from "@/components/orders/adjustments/product-picker";
import { orderKeys, type OrderPermissions } from "../order-domain";
import { DetailSection } from "./detail-section";

const keys = {
  exchanges: (id: string) => [...orderKeys.detail(id), "exchanges"] as const,
  issues: (id: string) => [...orderKeys.detail(id), "issues"] as const,
};

const SWAP: Record<SwapStatusValue, { label: string; variant: "success" | "warning" | "neutral" | "danger" | "info" }> = {
  AWAITING_SWAP: { label: "Waiting for swap", variant: "warning" },
  SWAPPED: { label: "Swapped — old item on its way back", variant: "info" },
  KEPT_BOTH: { label: "Customer kept both (paid)", variant: "neutral" },
  REFUSED: { label: "Customer refused", variant: "danger" },
  OLD_RECEIVED: { label: "Old item received", variant: "success" },
  OLD_MISSING: { label: "Old item not back", variant: "danger" },
};
const CHANNEL_LABEL: Record<IssueChannelValue, string> = { CALL: "Phone call", WHATSAPP: "WhatsApp", MESSENGER: "Messenger", OTHER: "Other" };
const EXCHANGEABLE = ["DELIVERED", "PARTIALLY_DELIVERED"];
const itemLabel = (i: { productNameSnapshot: string; sizeSnapshot: string | null; colorSnapshot: string | null }) =>
  [i.productNameSnapshot, [i.sizeSnapshot, i.colorSnapshot].filter(Boolean).join(" / ")].filter(Boolean).join(" — ");

/**
 * Problems the customer reported (torn, stain…) and door-swap exchanges of a delivered order. A reported problem shows
 * again on the scanner when the item comes back; an exchange ships the new size with the full price protected as COD.
 */
export function ExchangeSection({ order, perms }: { order: Order; perms: OrderPermissions }) {
  const [dialog, setDialog] = useState<"issue" | "exchange" | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const exchanges = useQuery({ queryKey: keys.exchanges(order.id), queryFn: () => api.listOrderExchanges(order.id) });
  const issues = useQuery({ queryKey: keys.issues(order.id), queryFn: () => api.listOrderIssues(order.id) });
  const rows = exchanges.data?.exchanges ?? [];
  const problems = issues.data?.issues ?? [];
  const canExchange = perms.manage && !order.deletedAt && EXCHANGEABLE.includes(order.status);
  const canReport = perms.manage && !order.deletedAt;
  if (!canReport && rows.length === 0 && problems.length === 0) return null;

  return (
    <DetailSection
      title="Problems & exchanges"
      icon={ArrowLeftRight}
      testId="order-exchanges"
      actions={
        <div className="flex flex-wrap gap-2">
          {canReport && (
            <Button size="sm" variant="outline" onClick={() => setDialog("issue")} data-testid="report-problem">
              <MessageSquareWarning size={14} aria-hidden="true" /> Report a problem
            </Button>
          )}
          {canExchange && (
            <Button size="sm" variant="outline" onClick={() => { setAnswering(null); setDialog("exchange"); }} data-testid="start-exchange">
              <ArrowLeftRight size={14} aria-hidden="true" /> Exchange
            </Button>
          )}
        </div>
      }
    >
      {exchanges.isError || issues.isError ? (
        <p className="text-sm text-danger-700">Couldn&apos;t load problems and exchanges — refresh the page.</p>
      ) : exchanges.isLoading || issues.isLoading ? (
        <div className="h-12 rounded-xl ui-skeleton" aria-busy="true" />
      ) : rows.length === 0 && problems.length === 0 ? (
        <p className="text-sm text-ink-500">Nothing reported. If the customer calls about a torn or wrong item, record it here — the scanner shows it when the item comes back.</p>
      ) : (
        <div className="space-y-3">
          {problems.length > 0 && (
            <ul className="space-y-2" aria-label="Reported problems" data-testid="reported-problems">
              {problems.map((p) => (
                <li key={p.id} className={cn("rounded-xl border p-3 text-sm", p.resolvedAt ? "border-line-subtle" : "border-warning-200 bg-warning-50")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertTriangle size={14} className={p.resolvedAt ? "text-ink-400" : "text-warning-700"} aria-hidden="true" />
                    <span className="font-medium text-ink-900">{p.kindLabel}</span>
                    {p.itemLabel && <span className="text-ink-600">· {p.itemLabel}</span>}
                    <Badge variant={p.resolvedAt ? "neutral" : "warning"} dot>
                      {p.resolvedAt ? "Checked" : "Open"}
                    </Badge>
                    <span className="ml-auto text-xs text-ink-400">{formatStoreDateTime(p.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-ink-700">&ldquo;{p.note}&rdquo;</p>
                  <p className="text-xs text-ink-500">
                    {CHANNEL_LABEL[p.channel as IssueChannelValue] ?? p.channel}
                    {p.reportedByName ? ` · ${p.reportedByName}` : ""}
                    {p.resolution ? ` · ${p.resolution}` : ""}
                  </p>
                  {!p.resolvedAt && canExchange && p.orderItemId && !rows.some((r) => r.swapStatus === "AWAITING_SWAP") && (
                    <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => { setAnswering(p.id); setDialog("exchange"); }}>
                      <ArrowLeftRight size={13} aria-hidden="true" /> Send a replacement
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <ol className="space-y-2" aria-label="Exchanges" data-testid="exchange-list">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-line-subtle p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900">
                      {[r.original.size, r.original.color].filter(Boolean).join(" / ")} → {[r.requested.size, r.requested.color].filter(Boolean).join(" / ")}
                    </span>
                    {r.swapStatus && (
                      <Badge variant={SWAP[r.swapStatus].variant} dot>
                        {SWAP[r.swapStatus].label}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-ink-400">{formatStoreDateTime(r.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-ink-700">
                    {r.reasonLabel}
                    {r.swap && r.total !== null && r.protectedCod !== null && (
                      <span className="tabular-nums">
                        {" "}· {r.total > 0 ? `${formatPrice(r.total)} with the old item` : "free with the old item"} · {formatPrice(r.protectedCod)} if they keep both
                      </span>
                    )}
                  </p>
                  {r.exchangeOrder && (
                    <Link href={`/admin/orders/${r.exchangeOrder.id}`} className="text-xs font-medium text-ink-900 underline-offset-2 hover:underline" data-testid="exchange-order-link">
                      Replacement order {r.exchangeOrder.orderNumber}
                    </Link>
                  )}
                  {r.overrideReason && <p className="text-xs text-ink-500">Past the exchange window: {r.overrideReason}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <ReportProblemDialog order={order} open={dialog === "issue"} onClose={() => setDialog(null)} />
      {dialog === "exchange" && <ExchangeDialog order={order} issueId={answering} issues={problems} onClose={() => setDialog(null)} />}
    </DetailSection>
  );
}

function ReportProblemDialog({ order, open, onClose }: { order: Order; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [itemId, setItemId] = useState<string>(order.items.length === 1 ? order.items[0]!.id : "");
  const [kind, setKind] = useState<OrderIssueKindValue>("TORN");
  const [channel, setChannel] = useState<IssueChannelValue>("CALL");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api.reportOrderIssue(order.id, { orderItemId: itemId || null, kind, channel, note: note.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.issues(order.id) });
      toast.success("Problem recorded — the scanner will show it when the item comes back");
      setNote("");
      onClose();
    },
  });
  const tooShort = note.trim().length < 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a problem"
      description="What the customer said about the item. It shows on the scanner when the item comes back, so it's checked and kept off the shelf if damaged."
      widthClassName="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={tooShort} loading={save.isPending} data-testid="save-problem">
            Save problem
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {order.items.length > 1 && (
          <Field htmlFor="issue-item" label="Item">
            <Select id="issue-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">The whole parcel</option>
              {order.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {itemLabel(i)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-900">Problem</legend>
          <div className="flex flex-wrap gap-2">
            {ORDER_ISSUE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                data-testid={`issue-kind-${k}`}
                className={cn("min-h-11 rounded-xl border px-3 text-sm", kind === k ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line-strong bg-surface hover:border-ink-400")}
              >
                {ORDER_ISSUE_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>
        <Field htmlFor="issue-channel" label="How they told us">
          <Select id="issue-channel" value={channel} onChange={(e) => setChannel(e.target.value as IssueChannelValue)}>
            {ISSUE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field htmlFor="issue-note" label="What the customer said" hint="Where it is and how bad, e.g. “left sleeve torn, photo on WhatsApp”." error={save.error ? errorText(save.error) : undefined}>
          <Textarea id="issue-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Modal>
  );
}

function ExchangeDialog({ order, issueId, issues, onClose }: { order: Order; issueId: string | null; issues: api.OrderIssueRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const answered = issues.find((i) => i.id === issueId) ?? null;
  const [itemId, setItemId] = useState<string>(answered?.orderItemId ?? (order.items.length === 1 ? order.items[0]!.id : ""));
  const item = order.items.find((i) => i.id === itemId) ?? null;
  const [variantId, setVariantId] = useState<string | null>(null);
  const [reason, setReason] = useState<ExchangeReasonValue>(answered ? (answered.kind === "WRONG_ITEM" ? "WRONG_ITEM_SENT" : "DEFECT") : "CUSTOMER_SIZE");
  const [evidence, setEvidence] = useState("");
  const [fee, setFee] = useState<string>("");
  const [override, setOverride] = useState("");
  const ourFault = EXCHANGE_OUR_FAULT.includes(reason);
  const slug = item?.live?.productSlug ?? null;
  const product = useQuery({ queryKey: ["product-slug", slug], queryFn: () => getProductBySlug(slug!), enabled: Boolean(slug) });
  useEffect(() => setVariantId(null), [itemId]);

  const input = item && variantId
    ? {
        orderItemId: item.id,
        requestedVariantId: variantId,
        reason,
        evidenceNote: evidence.trim() || null,
        issueId: answered?.id ?? null,
        fee: !ourFault && fee.trim() !== "" ? Number(fee) : undefined,
        overrideReason: override.trim() || null,
      }
    : null;
  const preview = useQuery({
    queryKey: ["door-swap-preview", order.id, input],
    queryFn: () => api.previewDoorSwap(order.id, input!),
    enabled: Boolean(input) && (fee.trim() === "" || Number.isFinite(Number(fee))),
  });
  const create = useMutation({
    mutationFn: () => api.createDoorSwap(order.id, input!, idempotencyKeyFor(`door-swap:${order.id}`, input)),
    onSuccess: (r) => {
      settleIdempotencyKey(`door-swap:${order.id}`);
      qc.invalidateQueries({ queryKey: keys.exchanges(order.id) });
      qc.invalidateQueries({ queryKey: orderKeys.detail(order.id) });
      toast.success(`Replacement ${r.exchangeOrder?.orderNumber ?? ""} created — book it with the courier as usual`);
      onClose();
    },
  });
  const p = preview.data;
  const needsEvidence = ourFault && !answered && evidence.trim().length < 3;
  const needsOverride = Boolean(p?.pastWindow) && override.trim().length < 5;
  const blocked = !input || needsEvidence || needsOverride || !p || !p.replacement.inStock || preview.isFetching;

  return (
    <Modal
      open
      onClose={onClose}
      title="Exchange"
      description="The new size goes out with the full price protected as cash on delivery. The rider takes only the exchange amount when the customer hands the old item over."
      widthClassName="max-w-xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={blocked} loading={create.isPending} data-testid="create-exchange">
            Create exchange
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {answered && (
          <p className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-ink-700">
            For the reported problem: <span className="font-medium">{answered.kindLabel}</span> — &ldquo;{answered.note}&rdquo;
          </p>
        )}
        {order.items.length > 1 && (
          <Field htmlFor="exchange-item" label="Item">
            <Select id="exchange-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Choose the item…</option>
              {order.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {itemLabel(i)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {item && (
          <div data-testid="exchange-variant">
            <p className="mb-1.5 text-sm font-medium text-ink-900">
              New size or colour <span className="font-normal text-ink-500">(now {[item.sizeSnapshot, item.colorSnapshot].filter(Boolean).join(" / ")})</span>
            </p>
            {!slug ? (
              <p className="text-sm text-ink-500">This product is no longer in the catalogue — create the replacement as a new order.</p>
            ) : product.isError ? (
              <p className="text-sm text-danger-700">Couldn&apos;t load the sizes — try again.</p>
            ) : !product.data ? (
              <div className="h-11 rounded-xl ui-skeleton" aria-busy="true" />
            ) : (
              <VariantChooser product={product.data.product} exclude={[item.variantId]} selected={variantId} onSelect={setVariantId} />
            )}
          </div>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-900">Why</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EXCHANGE_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
                data-testid={`exchange-reason-${r}`}
                className={cn("min-h-11 rounded-xl border px-3 py-2 text-left text-sm", reason === r ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line-strong bg-surface hover:border-ink-400")}
              >
                <span className="block font-medium">{EXCHANGE_REASON_LABEL[r]}</span>
                <span className={cn("block text-xs", reason === r ? "text-cream-100" : "text-ink-500")}>{EXCHANGE_OUR_FAULT.includes(r) ? "Our fault — free" : "Customer pays delivery"}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {ourFault && !answered && (
          <Field htmlFor="exchange-evidence" label="What proves it" hint="E.g. “WhatsApp photo: torn left sleeve”." error={needsEvidence && evidence ? "Say what proves the problem" : undefined}>
            <Input id="exchange-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={300} />
          </Field>
        )}
        {!ourFault && (
          <Field htmlFor="exchange-fee" label="Delivery charge" hint={p ? `Store charge for this area: ${formatPrice(p.fee)}. Change it only if you agreed another amount.` : undefined}>
            <Input id="exchange-fee" inputMode="numeric" value={fee} placeholder={p ? String(p.fee) : ""} onChange={(e) => setFee(e.target.value.replace(/[^\d]/g, ""))} />
          </Field>
        )}
        {p?.pastWindow && (
          <Field htmlFor="exchange-override" label={`Delivered ${p.daysSinceDelivery} days ago — exchanges are taken within ${p.windowDays} days`} hint="Say why this one is accepted anyway; it's kept on the record.">
            <Input id="exchange-override" value={override} onChange={(e) => setOverride(e.target.value)} maxLength={200} />
          </Field>
        )}
        {p && (
          <div className="rounded-xl border border-line-subtle bg-surface-muted p-3 text-sm" data-testid="exchange-summary">
            {!p.replacement.inStock ? (
              <p className="text-danger-700">That size is out of stock.</p>
            ) : (
              <>
                <p className="font-medium text-ink-900 tabular-nums">
                  Customer pays {p.total > 0 ? formatPrice(p.total) : "nothing"} when the old item is handed over · {formatPrice(p.protectedCod)} if they keep both
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  The courier is booked for {formatPrice(p.protectedCod)}; the rider note tells them to take only {formatPrice(p.total)} with the old item.
                  {p.owedBack > 0 && ` The new item is ${formatPrice(p.owedBack)} cheaper — give that back as Store Balance if agreed.`}
                </p>
              </>
            )}
          </div>
        )}
        {(create.error || preview.error) && <p className="text-sm text-danger-700">{errorText(create.error ?? preview.error)}</p>}
      </div>
    </Modal>
  );
}

function errorText(err: unknown) {
  return err instanceof ApiError ? err.message : "Something went wrong — try again.";
}
