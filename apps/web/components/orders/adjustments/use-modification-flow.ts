"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Order, OrderModificationInput, OrderModificationPreview } from "@clothing-brand/shared";
import { idempotencyKeyFor, settleIdempotencyKey } from "@/lib/idempotency";
import { adjustmentErrorOf, type AdjustmentError } from "@/lib/order-adjustment-errors";

/**
 * The change-order flow shared by the customer page and the staff dialog (docs/ORDER_ADJUSTMENTS.md §3):
 *
 *   edit (lines + delivery details) → server preview → review → confirm (with the preview's token) → applied
 *
 * The draft only holds WHAT the person wants (variants, quantities, address). Every price, total, discount, shipping
 * fee and money consequence comes from the server's preview; confirming sends the preview token so a price that moved in
 * the meantime is refused by the server (409 MODIFICATION_CHANGED) and the fresh preview is shown for a second look.
 */
export interface DraftLine {
  key: string;
  variantId: string;
  productName: string;
  size: string;
  color: string;
  productSlug: string | null;
  imageUrl: string | null;
  quantity: number;
  /** Units the order holds now (0 for an added line). */
  originalQuantity: number;
  /** Shown as a hint only ("৳1,200 each"); never used to compute anything. */
  unitPriceHint: number | null;
}

export interface DraftAddress {
  customerName: string;
  customerPhone: string;
  shippingDivision: string;
  shippingDistrict: string;
  shippingArea: string;
  shippingAddressLine: string;
}

/** Most units of one item per order — the order schemas' own cap (checkoutItemSchema). */
export const MAX_LINE_QUANTITY = 20;

export function draftLinesOf(order: Order): DraftLine[] {
  const byVariant = new Map<string, DraftLine>();
  for (const item of order.items) {
    const existing = byVariant.get(item.variantId);
    if (existing) {
      existing.quantity += item.quantity;
      existing.originalQuantity += item.quantity;
      continue;
    }
    byVariant.set(item.variantId, {
      key: item.variantId,
      variantId: item.variantId,
      productName: item.productNameSnapshot,
      size: item.sizeSnapshot,
      color: item.colorSnapshot,
      productSlug: item.live?.productSlug ?? null,
      imageUrl: item.live?.imageUrl ?? null,
      quantity: item.quantity,
      originalQuantity: item.quantity,
      unitPriceHint: Number(item.priceSnapshot),
    });
  }
  return [...byVariant.values()];
}

export function draftAddressOf(order: Order): DraftAddress {
  return {
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    shippingDivision: order.shippingDivision,
    shippingDistrict: order.shippingDistrict,
    shippingArea: order.shippingArea,
    shippingAddressLine: order.shippingAddressLine,
  };
}

export interface ModificationAdapter<R> {
  preview: (input: OrderModificationInput) => Promise<{ preview: OrderModificationPreview }>;
  apply: (input: OrderModificationInput, idempotencyKey: string) => Promise<R>;
}

export function useModificationFlow<R>({
  order,
  adapter,
  onApplied,
  extraInput,
}: {
  order: Order;
  adapter: ModificationAdapter<R>;
  onApplied: (result: R) => void;
  /** Staff-only switches (e.g. collectDifferenceLater). */
  extraInput?: Partial<OrderModificationInput>;
}) {
  const originalAddress = useMemo(() => draftAddressOf(order), [order]);
  const [lines, setLines] = useState<DraftLine[]>(() => draftLinesOf(order));
  const [address, setAddress] = useState<DraftAddress>(originalAddress);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [preview, setPreview] = useState<OrderModificationPreview | null>(null);
  const [error, setError] = useState<AdjustmentError | null>(null);
  /** The server re-priced the change between review and confirm. */
  const [repriced, setRepriced] = useState(false);

  const addressChanged = JSON.stringify(address) !== JSON.stringify(originalAddress);
  const input: OrderModificationInput = {
    items: lines.filter((l) => l.quantity > 0).map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    // The server validates the division against its own list; the draft holds what the editor derived from the district.
    ...(addressChanged ? { shipping: address as NonNullable<OrderModificationInput["shipping"]> } : {}),
    reason: null,
    ...extraInput,
  };
  const itemsChanged = lines.some((l) => l.quantity !== l.originalQuantity);
  const dirty = itemsChanged || addressChanged;
  const empty = input.items.length === 0;

  const previewMutation = useMutation({
    mutationFn: () => adapter.preview(input),
    onSuccess: ({ preview: p }) => {
      setPreview(p);
      setRepriced(false);
      setError(null);
      setStep("review");
    },
    onError: (err) => setError(adjustmentErrorOf(err, "The change couldn't be priced")),
  });

  const scope = `order-change:${order.id}`;
  const applyMutation = useMutation({
    mutationFn: () => {
      const body = { ...input, previewToken: preview?.previewToken };
      return adapter.apply(body, idempotencyKeyFor(scope, body));
    },
    onSuccess: (result) => {
      settleIdempotencyKey(scope);
      onApplied(result);
    },
    onError: (err) => {
      const e = adjustmentErrorOf(err, "The change couldn't be applied");
      if (e.kind === "changed" && e.preview) {
        // Never apply the stale version: show what the server priced now and ask again.
        setPreview(e.preview);
        setRepriced(true);
        setError(null);
        return;
      }
      setError(e);
      if (e.kind === "stock") setStep("edit");
    },
  });

  return {
    lines,
    setLines,
    address,
    setAddress,
    addressChanged,
    step,
    preview,
    error,
    repriced,
    dirty,
    empty,
    previewing: previewMutation.isPending,
    applying: applyMutation.isPending,
    review: () => previewMutation.mutate(),
    confirm: () => applyMutation.mutate(),
    backToEdit: () => {
      setStep("edit");
      setError(null);
    },
    clearError: () => setError(null),
  };
}

export type ModificationFlow = ReturnType<typeof useModificationFlow>;
