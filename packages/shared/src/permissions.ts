/**
 * The one admin permission vocabulary and role → permission map (Phase 10, docs/PHASE_10_AUDIT.md). The API enforces it
 * (`requirePermission`); the web never re-derives it — it asks `can()` over the list `/api/auth/me` returns.
 *
 * The STAFF grant reproduces the pre-Phase-10 OWNER/STAFF access exactly (verified route by route). Restricting STAFF is
 * an owner decision (BUSINESS_DECISIONS PD-10.1 / PD-10.2) and, once made, a change to this map only.
 */
export const ADMIN_ROLES = ["OWNER", "STAFF"] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];

export const PERMISSIONS = [
  // team & oversight
  "users.manage", // admin accounts, invites, roles, admin passwords
  "audit.read",
  // catalog
  "catalog.read",
  "catalog.manage", // products, categories, attributes, images (incl. current cost)
  "catalog.configure", // product types, templates, guides, materials, SKU pattern, sections
  "catalog.export",
  "catalog.purge", // permanent product delete
  "products.import",
  "ai.use", // billed AI generation
  // orders & money
  "orders.read",
  "orders.manage", // manual order, status, details, follow-up, partial-delivery reconcile
  "orders.adjust_price",
  "orders.export",
  "orders.delete", // delete / restore / permanent
  "payments.read",
  "payments.record", // manual payment
  "refunds.manage", // record / complete refunds
  "returns.manage", // review returns & exchanges
  "courier.manage",
  // commerce configuration
  "promotions.manage", // coupons, bundles, flash sales
  "content.manage", // banners, sections, reviews, feedback, payment methods, editor uploads
  "storefront.configure", // redirects, social links
  "settings.manage", // store settings, SMS provider settings, branding
  // customers
  "customers.read",
  "customers.manage", // CRM flags, admin notes, manual customer
  "customers.message", // ad-hoc / bulk SMS
  "loyalty.adjust",
  "campaigns.manage", // campaigns, SMS templates
  // insight & operations
  "analytics.read", // analytics, BI, metrics (incl. COGS / margin)
  "analytics.export",
  "inventory.read",
  "inventory.adjust",
  "ops.read", // outbox status, reliability report, drift reports
  "ops.repair", // outbox retry, payment-ledger repair, read-model rebuild
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Only OWNER holds these. Everything else is granted to STAFF as well (today's behaviour). */
export const OWNER_ONLY_PERMISSIONS = [
  "users.manage",
  "audit.read",
  "catalog.configure",
  "catalog.purge",
  "products.import",
  "ai.use",
  "orders.delete",
  "storefront.configure",
  "settings.manage",
  "ops.repair",
] as const satisfies readonly Permission[];

const ownerOnly = new Set<Permission>(OWNER_ONLY_PERMISSIONS);

export const ROLE_PERMISSIONS: Readonly<Record<AdminRoleName, readonly Permission[]>> = Object.freeze({
  OWNER: Object.freeze([...PERMISSIONS]),
  STAFF: Object.freeze(PERMISSIONS.filter((p) => !ownerOnly.has(p))),
});

export function permissionsForRole(role: AdminRoleName): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: AdminRoleName, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
