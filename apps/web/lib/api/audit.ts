import type { AuditLogEntry, PaginatedResult } from "@clothing-brand/shared";
import { apiFetch } from "../api-client";

export function listAuditLogs(page = 1, pageSize = 30) {
  return apiFetch<PaginatedResult<AuditLogEntry>>(`/api/audit-logs?page=${page}&pageSize=${pageSize}`);
}
