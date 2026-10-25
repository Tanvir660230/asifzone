import type {
  AdminLoginInput,
  CreateAdminInviteInput,
  AcceptAdminInviteInput,
  UpdateAdminInput,
  GoogleLoginInput,
  Permission,
  AdminRoleName,
} from "@clothing-brand/shared";
import { apiFetch } from "./api-client";
import { clearAdminHint } from "./admin-hint";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRoleName;
  /** Resolved by the API from the admin's current role (Phase 10). */
  permissions: Permission[];
  /** 2-step sign-in is on for this admin (admin audit phase 2). */
  twoStepEnabled?: boolean;
}

/** A sign-in either finishes (session cookies set) or, with 2-step sign-in on, waits for the code. */
export type SignInResponse = { admin: AdminUser } | { twoStepRequired: true; challenge: string };
export const needsTwoStep = (r: SignInResponse): r is { twoStepRequired: true; challenge: string } => "twoStepRequired" in r;

/** UX only — hides what the API would refuse anyway. The API enforces every permission itself (requirePermission); the
 * web never re-derives permissions from the role. */
export function adminCan(admin: Pick<AdminUser, "permissions"> | null | undefined, permission: Permission): boolean {
  return Boolean(admin?.permissions?.includes(permission));
}

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  role: AdminRoleName;
  isActive: boolean;
  createdAt: string;
  twoStepEnabled?: boolean;
  /** When the admin last used the console (sessions renew every few minutes while it's open); null: never signed in. */
  lastActiveAt?: string | null;
  /** Devices signed in right now. */
  activeSessions?: number;
}

export interface AdminInvite {
  id: string;
  name: string;
  email: string;
  role: AdminRoleName;
  expiresAt: string;
  createdAt: string;
}

export function loginAdmin(input: AdminLoginInput) {
  return apiFetch<SignInResponse>("/api/auth/login", { method: "POST", body: input });
}

export function loginAdminWithGoogle(input: GoogleLoginInput) {
  return apiFetch<SignInResponse>("/api/auth/google", { method: "POST", body: input });
}

/** The second step: the challenge from the first step plus the app's code (or a recovery code). */
export function loginAdminTwoStep(challenge: string, code: string) {
  return apiFetch<{ admin: AdminUser }>("/api/auth/login/2fa", { method: "POST", body: { challenge, code } });
}

// ── 2-step sign-in, for yourself ─────────────────────────────────────────────────────────────────────────────────────
export function startTwoStepSetup() {
  return apiFetch<{ secret: string; otpauthUrl: string }>("/api/auth/2fa/setup", { method: "POST" });
}
export function enableTwoStep(code: string) {
  return apiFetch<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { method: "POST", body: { code } });
}
export function disableTwoStep(code: string) {
  return apiFetch<void>("/api/auth/2fa/disable", { method: "POST", body: { code } });
}
/** An owner resets a teammate's 2-step sign-in (their sessions end too). */
export function resetAdminTwoStep(id: string) {
  return apiFetch<void>(`/api/auth/admins/${id}/2fa`, { method: "DELETE" });
}
/** An owner signs a teammate out of every device. */
export function revokeAllAdminSessions(id: string) {
  return apiFetch<{ revoked: number }>(`/api/auth/admins/${id}/sessions/revoke`, { method: "POST" });
}

export function logoutAdmin() {
  clearAdminHint();
  return apiFetch<void>("/api/auth/logout", { method: "POST" });
}

export function logoutAllDevices() {
  clearAdminHint();
  return apiFetch<void>("/api/auth/logout-all", { method: "POST" });
}

export interface AdminSession {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** The session making the request (this browser). */
  current: boolean;
}

export function listAdminSessions() {
  return apiFetch<{ sessions: AdminSession[] }>("/api/auth/sessions");
}

/** Signs out every other device; this one stays signed in. */
export function revokeOtherAdminSessions() {
  return apiFetch<{ revoked: number }>("/api/auth/sessions/revoke-others", { method: "POST" });
}

/** Signs one of my other devices out; the current one is Log out. */
export function revokeAdminSession(id: string) {
  return apiFetch<void>(`/api/auth/sessions/${id}`, { method: "DELETE" });
}

export function getCurrentAdmin() {
  return apiFetch<{ admin: AdminUser }>("/api/auth/me");
}

/** Each role and what it can do — from the API's role map (the web never re-derives it). */
export interface RoleCatalogEntry { role: string; kind: "ALL" | "STORE" | "FINANCE"; permissions: string[]; lacks: string[] }
export function listAdmins() {
  return apiFetch<{ admins: AdminAccount[]; roles: RoleCatalogEntry[] }>("/api/auth/admins");
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

/** `acceptUrl` is the invite link, for passing on by hand — the only way in when `emailSent` is false. */
export function createAdminInvite(input: CreateAdminInviteInput) {
  return apiFetch<{ message: string; emailSent: boolean; acceptUrl: string }>("/api/auth/admin-invites", { method: "POST", body: input });
}

export function revokeAdminInvite(id: string) {
  return apiFetch<void>(`/api/auth/admin-invites/${id}`, { method: "DELETE" });
}

export function acceptAdminInvite(input: AcceptAdminInviteInput) {
  return apiFetch<{ admin: AdminUser }>("/api/auth/admin-invites/accept", { method: "POST", body: input });
}
