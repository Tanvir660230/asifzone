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
