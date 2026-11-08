import type { NotificationEntry, NotificationView } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** One of the bell's lists. `unreadCount` is always the important list's (the badge); `activityUnread` the routine one's. */
export function listNotifications(view: NotificationView = "important") {
  return apiFetch<{ items: NotificationEntry[]; view: NotificationView; unreadCount: number; activityUnread: number }>(`/api/notifications?view=${view}`);
}

export function markNotificationRead(id: string) {
  return apiFetch<void>(`/api/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead(view: NotificationView) {
  return apiFetch<void>(`/api/notifications/read-all?view=${view}`, { method: "POST" });
}
