import type { CreateFeedbackInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function submitFeedback(input: CreateFeedbackInput) {
  return apiFetch<{ submitted: true }>("/api/feedback", { method: "POST", body: input });
}
