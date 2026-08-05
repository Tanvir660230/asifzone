import type { SocialLink, CreateSocialLinkInput, UpdateSocialLinkInput } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listSocialLinks() {
  return apiFetch<{ links: SocialLink[] }>("/api/social-links");
}

export function createSocialLink(input: CreateSocialLinkInput) {
  return apiFetch<{ link: SocialLink }>("/api/social-links", { method: "POST", body: input });
}

export function updateSocialLink(id: string, input: UpdateSocialLinkInput) {
  return apiFetch<{ link: SocialLink }>(`/api/social-links/${id}`, { method: "PATCH", body: input });
}

export function deleteSocialLink(id: string) {
  return apiFetch<void>(`/api/social-links/${id}`, { method: "DELETE" });
}
