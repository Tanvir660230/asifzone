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
