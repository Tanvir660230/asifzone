import type { AdminLoginInput } from "@clothing-brand/shared";
import { apiFetch } from "./api-client";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "STAFF";
}

export function loginAdmin(input: AdminLoginInput) {
  return apiFetch<{ admin: AdminUser }>("/api/auth/login", { method: "POST", body: input });
}

export function logoutAdmin() {
  return apiFetch<void>("/api/auth/logout", { method: "POST" });
}

export function logoutAllDevices() {
  return apiFetch<void>("/api/auth/logout-all", { method: "POST" });
}

export interface AdminSession {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

export function listAdminSessions() {
  return apiFetch<{ sessions: AdminSession[] }>("/api/auth/sessions");
}

export function getCurrentAdmin() {
  return apiFetch<{ admin: AdminUser }>("/api/auth/me");
}
