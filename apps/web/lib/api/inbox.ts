import type { ConversationDetail, ConversationListRow, ConversationMessageRow, ConversationReplyInput, PaginatedResult } from "@clothing-brand/shared";
import { apiFetch, type FetchSignal } from "../api-client";

/** Messages › Inbox (Blueprint V2 R2): conversations with customers. */
export interface ConversationListParams {
  page?: number;
  pageSize?: number;
  status?: "open" | "handled" | "all";
  /** Only conversations assigned to me. */
  mine?: "true";
  search?: string;
}

export function listConversations(params: ConversationListParams = {}, { signal }: FetchSignal = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return apiFetch<PaginatedResult<ConversationListRow>>(`/api/v1/admin/conversations?${query.toString()}`, { signal });
}

export function getConversation(id: string) {
  return apiFetch<ConversationDetail>(`/api/v1/admin/conversations/${id}`);
}

/** Records the reply and queues it; delivery shows on the message ("sending" → "sent" / "failed"). */
export function replyToConversation(id: string, input: ConversationReplyInput) {
  return apiFetch<ConversationMessageRow>(`/api/v1/admin/conversations/${id}/replies`, { method: "POST", body: input });
}

/** Handled ↔ new, and/or take it (assignedToMe: true) or let it go (false). */
export function updateConversation(id: string, input: { status?: "OPEN" | "HANDLED"; assignedToMe?: boolean }) {
  return apiFetch<{ id: string; status: string; assignedTo: { id: string; name: string } | null }>(`/api/v1/admin/conversations/${id}`, { method: "PATCH", body: input });
}

export function deleteConversation(id: string) {
  return apiFetch<void>(`/api/v1/admin/conversations/${id}`, { method: "DELETE" });
}
