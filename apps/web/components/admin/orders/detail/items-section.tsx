"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, ShoppingBag } from "lucide-react";
import { adjustOrderPriceSchema, formatVariantLabel, priceAdjustmentBlocker, type Order } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatPrice, storeCurrencySymbol } from "@/lib/format";
import { cn } from "@/lib/utils";
import { orderLineAmount, type OrderPermissions } from "../order-domain";
import { BlockedHint, DetailSection } from "./detail-section";
import type { OrderDetailCommands } from "./use-order-detail-commands";
import { Thumbnail } from "@/components/admin/thumbnail";

function Row({ label, value, tone, strong }: { label: string; value: string; tone?: "success"; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", strong ? "border-t border-line-subtle pt-2 text-base font-semibold text-ink-900" : "text-ink-600", tone === "success" && "text-success-700")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** 3 — what was ordered (snapshots, with returned / restocked units) and the order's totals as the server stored them;
 * the negotiated price adjustment lives here, gated by the shared guard the API also applies. */
export function ItemsSection({ order, detail, perms }: { order: Order; detail: OrderDetailCommands; perms: OrderPermissions }) {
  const [draft, setDraft] = useState<{ amount: string; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [order.id]);

  const adjustment = Number(order.priceAdjustment);
  const blocker = priceAdjustmentBlocker(order, order.payment?.paid ?? 0);

  function save() {
    if (!draft) return;
    const amount = draft.amount.trim() === "" ? 0 : Number(draft.amount);
    const parsed = adjustOrderPriceSchema.safeParse({ priceAdjustment: amount, note: draft.note || null });
    if (!Number.isFinite(amount) || !parsed.success) {
      setError(parsed.success ? "Enter a valid amount" : (parsed.error.issues[0]?.message ?? "Enter a valid amount"));
      return;
    }
    setError(null);
    detail.price.mutate(parsed.data, { onSuccess: () => setDraft(null) });
  }

  return (
    <DetailSection title={`Items (${order.items.length})`} icon={ShoppingBag} testId="order-items">
      <ul className="divide-y divide-line-subtle">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line-subtle bg-ink-50">
              {item.live?.imageUrl ? (
                <Thumbnail src={item.live.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <Package size={16} className="text-ink-300" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              {item.live?.productSlug ? (
                <Link prefetch={false} href={`/product/${item.live.productSlug}`} target="_blank" className="font-medium text-ink-900 hover:text-info-700 hover:underline">
                  {item.productNameSnapshot}
                </Link>
              ) : (
                <span className="font-medium text-ink-900">{item.productNameSnapshot}</span>
              )}
              <p className="text-xs text-ink-500">
                {[formatVariantLabel(item.sizeSnapshot, item.colorSnapshot, "/"), `SKU ${item.skuSnapshot}`].filter(Boolean).join(" · ")}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                {item.quantity} × {formatPrice(item.priceSnapshot)}
                {item.returnedQuantity > 0 && <span className="ml-2 font-medium text-warning-700">{item.returnedQuantity} returned</span>}
                {item.restockedQuantity > 0 && <span className="ml-2 text-ink-400">{item.restockedQuantity} back in stock</span>}
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums text-ink-900">{formatPrice(orderLineAmount(item))}</span>
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink-700">
          <span className="font-medium text-ink-900">Customer note: </span>
          {order.notes}
        </p>
      )}

      <dl className="ml-auto mt-4 max-w-sm space-y-1.5 border-t border-line-subtle pt-3 text-sm">
        <Row label="Subtotal" value={formatPrice(order.subtotal)} />
        {Number(order.discount) > 0 && <Row label="Discount" value={`−${formatPrice(order.discount)}`} tone="success" />}
        <Row label="Shipping" value={formatPrice(order.shippingFee)} />
        {adjustment !== 0 && !draft && (
          <Row label="Price adjustment" value={`${adjustment > 0 ? "+" : "−"}${formatPrice(Math.abs(adjustment))}`} tone={adjustment < 0 ? "success" : undefined} />
        )}
        <Row label="Total" value={formatPrice(order.total)} strong />
      </dl>

      {perms.adjustPrice && (
        <div className="ml-auto mt-3 max-w-sm">
          {draft ? (
            <div className="space-y-3 rounded-xl border border-line-subtle p-3">
              <Field htmlFor="price-adjustment" label={`Price adjustment (${storeCurrencySymbol()}, negative = discount)`} hint="Replaces any earlier adjustment. The server recomputes the total." error={error ?? undefined}>
                <Input id="price-adjustment" type="number" step="1" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="e.g. -100" />
              </Field>
              <Field htmlFor="price-adjustment-note" label="Reason (optional)">
                <Input id="price-adjustment-note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. loyal customer" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button size="sm" loading={detail.price.isPending} onClick={save}>
                  Save adjustment
                </Button>
              </div>
            </div>
          ) : blocker ? (
            !order.deletedAt && <BlockedHint>Price can&apos;t be adjusted: {blocker.charAt(0).toLowerCase() + blocker.slice(1)}.</BlockedHint>
          ) : (
            <Button variant="link" size="sm" onClick={() => setDraft({ amount: String(adjustment), note: "" })}>
              {adjustment !== 0 ? "Edit price adjustment" : "Adjust price"}
            </Button>
          )}
        </div>
      )}
    </DetailSection>
  );
}
