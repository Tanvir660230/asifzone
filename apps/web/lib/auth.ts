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

export function getCurrentAdmin() {
  return apiFetch<{ admin: AdminUser }>("/api/auth/me");
}
