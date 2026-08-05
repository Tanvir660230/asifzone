import type { NotificationEntry } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listNotifications() {
  return apiFetch<{ items: NotificationEntry[]; unreadCount: number }>("/api/notifications");
}

export function markNotificationRead(id: string) {
  return apiFetch<void>(`/api/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return apiFetch<void>("/api/notifications/read-all", { method: "POST" });
}
