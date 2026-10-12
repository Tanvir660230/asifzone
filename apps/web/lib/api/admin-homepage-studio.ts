import type { HomepageSection, StudioSection } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface StudioState {
  version: number;
  sections: StudioSection[];
  hasDraft: boolean;
  updatedAt: string | null;
  liveSections: StudioSection[];
}

export interface StudioRevision {
  id: string;
  publishedAt: string;
  publishedByName: string | null;
  sectionCount: number;
}

const BASE = "/api/homepage-sections/studio";

export function getStudio() {
  return apiFetch<StudioState>(BASE);
}

/** 409 (ApiError.details.version) when the draft was saved elsewhere since `version`. */
export function saveStudioDraft(version: number, sections: StudioSection[]) {
  return apiFetch<{ version: number; updatedAt: string }>(`${BASE}/draft`, { method: "PUT", body: { version, sections } });
}

export function discardStudioDraft() {
  return apiFetch<void>(`${BASE}/draft`, { method: "DELETE" });
}

/** 400 with ApiError.details = { [sectionId]: messages[] } when sections need fixing. */
export function publishStudioDraft(version: number) {
  return apiFetch<{ sections: HomepageSection[] }>(`${BASE}/publish`, { method: "POST", body: { version } });
}

export function listStudioRevisions() {
  return apiFetch<{ revisions: StudioRevision[] }>(`${BASE}/revisions`);
}

export function restoreStudioRevision(id: string) {
  return apiFetch<StudioState>(`${BASE}/revisions/${encodeURIComponent(id)}/restore`, { method: "POST" });
}
