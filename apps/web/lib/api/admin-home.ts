import type { CreateSavedViewInput, ListPreferences, SavedViewRow } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";
import type { OrderStats } from "./admin-orders";
import type { PaymentsOverview } from "./payments-admin";

/** GET /api/v1/admin/attention — each section is null when this admin may not read it. */
export interface AdminAttention {
  orders: OrderStats | null;
  payments: PaymentsOverview | null;
  pendingReviews: number | null;
  unreadFeedback: number | null;
  unreadNotifications: number;
  /** Open errors seen in the last 24 h (Site health) — null without ops.read. */
  openErrors: number | null;
  /** Receipts flagged as a possible duplicate in the last 30 days with no reason given (blueprint P0.3) — null without purchasing.read. */
  possibleDuplicatePurchases?: number | null;
  /** Stock work waiting on a person — null without inventory.read. */
  stock?: { countLossesToApprove: number; fillFailures: number } | null;
  /** Parcels cancelled after shipping still out with the courier (blueprint P1.5) — null without orders.read. */
  parcelsToReceive?: { total: number; overdue: number; followUpDays: number } | null;
}

/** What the store's own data says it does (owner decision Q-G) — the menu shows Production only where it exists. */
export interface StoreCapabilities {
  production: boolean;
}

export function getStoreCapabilities() {
  return apiFetch<StoreCapabilities>("/api/v1/admin/store-capabilities");
}

export function getAttention() {
  return apiFetch<AdminAttention>("/api/v1/admin/attention");
}

/** Saved list views (DR-18): this admin's own plus the team's shared ones. */
export function listSavedViews(listKey: string) {
  return apiFetch<{ items: SavedViewRow[] }>(`/api/v1/admin/views?list=${encodeURIComponent(listKey)}`);
}

export function createSavedView(input: CreateSavedViewInput) {
  return apiFetch<SavedViewRow>("/api/v1/admin/views", { method: "POST", body: input });
}

export function deleteSavedView(id: string) {
  return apiFetch<void>(`/api/v1/admin/views/${id}`, { method: "DELETE" });
}

/** This admin's display preferences for one list (density, page size, hidden columns); `{}` = defaults. */
export function getListPreferences(listKey: string) {
  return apiFetch<ListPreferences>(`/api/v1/admin/list-preferences/${encodeURIComponent(listKey)}`);
}

export function updateListPreferences(listKey: string, patch: ListPreferences) {
  return apiFetch<ListPreferences>(`/api/v1/admin/list-preferences/${encodeURIComponent(listKey)}`, { method: "PUT", body: patch });
}
