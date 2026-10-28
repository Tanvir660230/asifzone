import type { CreateSavedViewInput, SavedViewRow } from "@clothing-brand/shared";
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
