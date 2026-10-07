import type { AuditLogEntry, PaginatedResult } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export interface AuditLogParams {
  page?: number;
  pageSize?: number;
  adminId?: string;
  entityType?: string;
  action?: string;
  entityId?: string;
  requestId?: string;
  from?: string;
  to?: string;
}

export function listAuditLogs(params: AuditLogParams = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return apiFetch<PaginatedResult<AuditLogEntry>>(`/api/audit-logs?${query.toString()}`);
}

/** What the log can be filtered by: areas with entries and every admin (incl. removed ones). */
export function getAuditFacets() {
  return apiFetch<{ entityTypes: string[]; admins: Array<{ id: string; name: string; isActive: boolean }> }>("/api/audit-logs/facets");
}
