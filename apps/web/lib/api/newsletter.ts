import { apiFetch } from "../api-client";

export function subscribeNewsletter(email: string) {
  return apiFetch<{ subscribed: boolean }>("/api/newsletter/subscribe", {
    method: "POST",
    body: { email },
  });
}
