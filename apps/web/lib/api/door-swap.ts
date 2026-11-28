import type { CreateDoorSwapInput, CreateOrderIssueInput, ExchangeReasonValue, OrderIssueKindValue, SwapStatusValue } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** Door-swap exchanges and customer-reported problems on an order (docs/superpowers/plans/2026-11-28-door-swap-exchange.md).
 * Every amount is computed by the server. */

export interface DoorSwapResult {
  preview: boolean;
  requestId: string | null;
  exchangeOrder: { id: string; orderNumber: string } | null;
  currency: string;
  fee: number;
  total: number;
  protectedCod: number;
  owedBack: number;
  original: { productName: string; size: string | null; color: string | null };
  replacement: { productName: string; size: string | null; color: string | null; inStock: boolean };
  deliveredAt: string | null;
  daysSinceDelivery: number | null;
  windowDays: number;
  pastWindow: boolean;
}

export interface OrderExchangeRow {
  id: string;
  swap: boolean;
  reason: ExchangeReasonValue | null;
  reasonLabel: string;
  swapStatus: SwapStatusValue | null;
  fee: number | null;
  total: number | null;
  protectedCod: number | null;
  evidenceNote: string | null;
  overrideReason: string | null;
  /** What the courier / a person said when the outcome was set, or the "check this" note. */
  swapNote: string | null;
  swapSettledAt: string | null;
  exchangeOrder: { id: string; orderNumber: string; status: string } | null;
  original: { productName: string; size: string | null; color: string | null };
  requested: { size: string | null; color: string | null };
  createdAt: string;
}

export interface OrderIssueRow {
  id: string;
  orderId: string;
  orderItemId: string | null;
  itemLabel: string | null;
  kind: OrderIssueKindValue;
  kindLabel: string;
  channel: string;
  note: string;
  reportedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export function previewDoorSwap(orderId: string, input: Omit<CreateDoorSwapInput, "preview">) {
  return apiFetch<DoorSwapResult>(`/api/orders/${orderId}/exchanges`, { method: "POST", body: { ...input, preview: true } });
}

export function createDoorSwap(orderId: string, input: Omit<CreateDoorSwapInput, "preview">, idempotencyKey: string) {
  return apiFetch<DoorSwapResult>(`/api/orders/${orderId}/exchanges`, { method: "POST", body: input, idempotencyKey });
}

export function listOrderExchanges(orderId: string) {
  return apiFetch<{ exchanges: OrderExchangeRow[] }>(`/api/orders/${orderId}/exchanges`);
}

export type SwapOutcomeInput = "SWAPPED" | "KEPT_BOTH" | "REFUSED" | "CANCELLED" | "OLD_MISSING";

export function setSwapOutcome(orderId: string, requestId: string, outcome: SwapOutcomeInput, note?: string | null) {
  return apiFetch<{ exchanges: OrderExchangeRow[] }>(`/api/orders/${orderId}/exchanges/${requestId}/outcome`, { method: "POST", body: { outcome, note: note ?? null } });
}

export interface DoorSwapBoardRow {
  id: string;
  reason: string | null;
  reasonLabel: string;
  swapStatus: SwapStatusValue | null;
  swapNote: string | null;
  needsCheck: boolean;
  swapSettledAt: string | null;
  protectedCod: number | null;
  total: number | null;
  order: { id: string; orderNumber: string; customerName: string; customerPhone: string };
  exchangeOrder: { id: string; orderNumber: string; status: string; courierStatus: string | null } | null;
  item: string;
  from: string;
  to: string;
  createdAt: string;
}

export function listDoorSwaps(filter: "open" | "all", init?: { signal?: AbortSignal }) {
  return apiFetch<{ items: DoorSwapBoardRow[] }>(`/api/door-swaps?filter=${filter}`, init);
}

export function reportOrderIssue(orderId: string, input: CreateOrderIssueInput) {
  return apiFetch<{ issue: OrderIssueRow }>(`/api/orders/${orderId}/issues`, { method: "POST", body: input });
}

export function listOrderIssues(orderId: string) {
  return apiFetch<{ issues: OrderIssueRow[] }>(`/api/orders/${orderId}/issues`);
}

export function resolveOrderIssue(orderId: string, issueId: string, resolution: string) {
  return apiFetch<void>(`/api/orders/${orderId}/issues/${issueId}/resolve`, { method: "POST", body: { resolution } });
}
