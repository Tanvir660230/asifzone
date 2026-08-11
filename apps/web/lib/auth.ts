import type {
  AdminLoginInput,
  CreateAdminInviteInput,
  AcceptAdminInviteInput,
  UpdateAdminInput,
} from "@clothing-brand/shared";
import { apiFetch } from "./api-client";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "STAFF";
}

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "STAFF";
  isActive: boolean;
  createdAt: string;
}

export interface AdminInvite {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "STAFF";
  expiresAt: string;
  createdAt: string;
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

export function listAdmins() {
  return apiFetch<{ admins: AdminAccount[] }>("/api/auth/admins");
}

export function setAdminActive(id: string, isActive: boolean) {
  return apiFetch<{ admin: AdminAccount }>(`/api/auth/admins/${id}/active`, { method: "PATCH", body: { isActive } });
}

export function updateAdmin(id: string, input: UpdateAdminInput) {
  return apiFetch<{ admin: AdminAccount }>(`/api/auth/admins/${id}`, { method: "PATCH", body: input });
}

export function setAdminPassword(id: string, password: string) {
  return apiFetch<void>(`/api/auth/admins/${id}/password`, { method: "PATCH", body: { password } });
}

export function listAdminInvites() {
  return apiFetch<{ invites: AdminInvite[] }>("/api/auth/admin-invites");
}

export function createAdminInvite(input: CreateAdminInviteInput) {
  return apiFetch<{ message: string }>("/api/auth/admin-invites", { method: "POST", body: input });
}

export function revokeAdminInvite(id: string) {
  return apiFetch<void>(`/api/auth/admin-invites/${id}`, { method: "DELETE" });
}

export function acceptAdminInvite(input: AcceptAdminInviteInput) {
  return apiFetch<{ admin: AdminUser }>("/api/auth/admin-invites/accept", { method: "POST", body: input });
}
