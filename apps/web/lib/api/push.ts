import type { PushSubscriptionSummary } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listMyPushSubscriptions() {
  return apiFetch<{ subscriptions: PushSubscriptionSummary[] }>("/api/customers/me/push-subscriptions");
}

export function registerPushSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return apiFetch<void>("/api/customers/me/push-subscriptions", {
    method: "POST",
    body: { endpoint: json.endpoint, keys: json.keys },
  });
}

export function unregisterPushSubscription(endpoint: string) {
  return apiFetch<void>(`/api/customers/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
  });
}
