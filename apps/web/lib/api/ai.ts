import type { GenerateAiContentInput } from "@clothing-brand/shared";
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
