import type { CreateSavedAnswerInput, SavedAnswersList, SavedAnswerView, UpdateSavedAnswerInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** Messages › Saved answers: the Inbox's learned answer library. */
export function listSavedAnswers() {
  return apiFetch<SavedAnswersList>("/api/v1/admin/saved-answers");
}

export function createSavedAnswer(input: CreateSavedAnswerInput) {
  return apiFetch<SavedAnswerView>("/api/v1/admin/saved-answers", { method: "POST", body: input });
}

export function updateSavedAnswer(id: string, input: UpdateSavedAnswerInput) {
  return apiFetch<SavedAnswerView>(`/api/v1/admin/saved-answers/${id}`, { method: "PATCH", body: input });
}

export function deleteSavedAnswer(id: string) {
  return apiFetch<void>(`/api/v1/admin/saved-answers/${id}`, { method: "DELETE" });
}
