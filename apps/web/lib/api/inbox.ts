import type { ConversationDetail, ConversationListRow, ConversationMessageRow, ConversationReplyInput, PaginatedResult } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

/** Messages › Inbox (Blueprint V2 R2): conversations with customers. */
export interface ConversationListParams {
  page?: number;
  pageSize?: number;
  status?: "open" | "handled" | "all";
  search?: string;
}

export function listConversations(params: ConversationListParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return apiFetch<PaginatedResult<ConversationListRow>>(`/api/v1/admin/conversations?${query.toString()}`);
}

export function getConversation(id: string) {
  return apiFetch<ConversationDetail>(`/api/v1/admin/conversations/${id}`);
}

/** Records the reply and queues it; delivery shows on the message ("sending" → "sent" / "failed"). */
export function replyToConversation(id: string, input: ConversationReplyInput) {
  return apiFetch<ConversationMessageRow>(`/api/v1/admin/conversations/${id}/replies`, { method: "POST", body: input });
}

export function setConversationStatus(id: string, status: "OPEN" | "HANDLED") {
  return apiFetch<{ id: string; status: string }>(`/api/v1/admin/conversations/${id}`, { method: "PATCH", body: { status } });
}

export function deleteConversation(id: string) {
  return apiFetch<void>(`/api/v1/admin/conversations/${id}`, { method: "DELETE" });
}
