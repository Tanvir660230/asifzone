/**
 * The canonical admin authorization service (Phase 10, docs/PHASE_10_AUDIT.md). Every admin request resolves its identity
 * here — from the database, not from the token's claims — and every permission decision goes through `can()`.
 *
 *  - Authentication: the access token only says *which* admin; `resolveAdminIdentity` loads that admin and refuses one that
 *    no longer exists or is deactivated. The **current** role decides, so a deactivation or a demotion takes effect on the
 *    very next request instead of when the 15-minute token expires (G-1).
 *  - Authorization: `can(identity, permission)` over the shared role map (`@clothing-brand/shared` permissions). No module
 *    compares role strings itself.
 */
import { permissionsForRole, type AdminRoleName, type Permission } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

export interface AdminIdentity {
  adminId: string;
  role: AdminRoleName;
  permissions: readonly Permission[];
}

/** The admin behind a verified token, or null when that account is gone or deactivated. */
export async function resolveAdminIdentity(adminId: unknown): Promise<AdminIdentity | null> {
  if (typeof adminId !== "string" || adminId.length === 0) return null;
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { id: true, role: true, isActive: true } });
  if (!admin || !admin.isActive) return null;
  return { adminId: admin.id, role: admin.role, permissions: permissionsForRole(admin.role) };
}

export function can(identity: Pick<AdminIdentity, "permissions"> | undefined | null, permission: Permission): boolean {
  return Boolean(identity?.permissions.includes(permission));
}
