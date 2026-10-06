import type { OrderModificationPreview } from "@clothing-brand/shared";
import { ApiError } from "./api-client";

/**
 * Server error → what the person should read and do next, for order adjustments (docs/ORDER_ADJUSTMENTS.md §12). The
 * server's own message is always the explanation — it already names the business reason ("Only 1 unit … can still be
 * returned", "This order has already been handed to the courier…"). This only adds the follow-up the screen should take,
 * keyed by the error `code`, so no screen falls back to a generic "Something went wrong" when a reason exists.
 */
export type AdjustmentErrorKind =
  /** Prices or the order moved while editing: show the fresh preview and ask for confirmation again. */
  | "changed"
  /** Stock ran out for an added item: keep the edit open so it can be adjusted. */
  | "stock"
  /** The order can't be changed any more (prepared, shipped, courier booked, cancelled…): close the editor, refresh. */
  | "not-editable"
  /** A link / change / return is no longer valid (used, expired, already reviewed): refresh and show the current state. */
  | "stale"
  /** Anything else with a server message. */
  | "other";

export interface AdjustmentError {
  kind: AdjustmentErrorKind;
  message: string;
  code: string | null;
  /** MODIFICATION_CHANGED carries the fresh server preview. */
  preview?: OrderModificationPreview;
}

const KIND_BY_CODE: Record<string, AdjustmentErrorKind> = {
  MODIFICATION_CHANGED: "changed",
  QUOTE_CHANGED: "changed",
  INSUFFICIENT_STOCK: "stock",
  ORDER_NOT_EDITABLE: "not-editable",
  ORDER_NOT_CANCELLABLE: "not-editable",
  RETURN_NOT_ALLOWED: "not-editable",
  RETURN_EXCEEDS_OUTSTANDING: "stale",
  PAYMENT_LINK_INACTIVE: "stale",
  PAYMENT_LINK_NOT_ALLOWED: "stale",
  MODIFICATION_NOT_PAYABLE: "stale",
};

export function adjustmentErrorOf(err: unknown, fallback: string): AdjustmentError {
  if (err instanceof ApiError) {
    const details = (err.details ?? {}) as { code?: string; preview?: OrderModificationPreview };
    const code = details.code ?? null;
    const kind = (code && KIND_BY_CODE[code]) || (err.status === 409 ? "stale" : "other");
    return { kind, message: err.message || fallback, code, preview: details.preview };
  }
  return { kind: "other", message: fallback, code: null };
}
