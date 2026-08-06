import type {
  Campaign,
  CampaignDetail,
  CampaignStatus,
  CreateCampaignInput,
  PaginatedResult,
  UpdateCampaignInput,
} from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listCampaigns(params: { page?: number; pageSize?: number; status?: CampaignStatus } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.status) query.set("status", params.status);
  return apiFetch<PaginatedResult<Campaign>>(`/api/campaigns?${query.toString()}`);
}

export function getCampaign(id: string) {
  return apiFetch<{ campaign: CampaignDetail }>(`/api/campaigns/${id}`);
}

export function createCampaign(input: CreateCampaignInput) {
  return apiFetch<{ campaign: Campaign }>("/api/campaigns", { method: "POST", body: input });
}

export function updateCampaign(id: string, input: UpdateCampaignInput) {
  return apiFetch<{ campaign: Campaign }>(`/api/campaigns/${id}`, { method: "PATCH", body: input });
}

export function deleteCampaign(id: string) {
  return apiFetch<void>(`/api/campaigns/${id}`, { method: "DELETE" });
}

export function scheduleCampaign(id: string, scheduledAt: string) {
  return apiFetch<{ campaign: Campaign }>(`/api/campaigns/${id}/schedule`, {
    method: "POST",
    body: { scheduledAt },
  });
}

export function cancelCampaignSchedule(id: string) {
  return apiFetch<{ campaign: Campaign }>(`/api/campaigns/${id}/cancel-schedule`, { method: "POST" });
}

export function sendCampaignNow(id: string) {
  return apiFetch<{ campaign: Campaign }>(`/api/campaigns/${id}/send`, { method: "POST" });
}
