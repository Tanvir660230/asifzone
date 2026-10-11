import type { AiChatInput, AiChatResponse, AiProposalView, GenerateAiContentInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function getAiStatus() {
  return apiFetch<{ configured: boolean }>("/api/ai/status");
}

export function generateAiContent(input: GenerateAiContentInput) {
  return apiFetch<{ text: string }>("/api/ai/generate", { method: "POST", body: input });
}

export function generateImageAltText(imageUrl: string) {
  return apiFetch<{ text: string }>("/api/ai/image-alt-text", { method: "POST", body: { imageUrl } });
}

/** The assistant (Blueprint V2 §T): read answers plus proposals — nothing changes until a proposal is confirmed. */
export function chat(messages: AiChatInput["messages"]) {
  return apiFetch<AiChatResponse>("/api/ai/chat", { method: "POST", body: { messages } });
}

export function executeProposal(id: string) {
  return apiFetch<AiProposalView & { message?: string }>(`/api/ai/proposals/${id}/execute`, { method: "POST" });
}

export function cancelProposal(id: string) {
  return apiFetch<AiProposalView>(`/api/ai/proposals/${id}/cancel`, { method: "POST" });
}
