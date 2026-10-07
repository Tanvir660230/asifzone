/**
 * The one admin permission vocabulary and role → permission map (Phase 10, docs/PHASE_10_AUDIT.md). The API enforces it
 * (`requirePermission`); the web never re-derives it — it asks `can()` over the list `/api/auth/me` returns.
 *
 * The STAFF grant is the pre-Phase-10 OWNER/STAFF access (verified route by route) with the owner's decisions applied
 * (BUSINESS_DECISIONS): PD-10.1 made permanent coupon / category delete OWNER-only (`promotions.purge`, `catalog.purge`);
 * PD-10.2 kept refunds, manual payments, price and loyalty adjustments, SMS, exports and financial analytics with STAFF.
 * Any further change is an owner decision and a change to this map only.
 */
/** OWNER and STAFF run the store; FINANCE_ADMIN, ACCOUNTANT and FINANCE_VIEWER (Financial Core Phase 3,
 * docs/FINANCE_PHASE_3.md §11) work in the books only — they hold no commerce permission. */
export const ADMIN_ROLES = ["OWNER", "STAFF", "FINANCE_ADMIN", "ACCOUNTANT", "FINANCE_VIEWER"] as const;
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
  "catalog.purge", // permanent catalog delete (products, categories)
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
  "promotions.purge", // permanent coupon delete (PD-10.1)
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
  // financial core (docs/FINANCE_PHASE_1.md §7) — OWNER-only until the owner decides on a finance role (F0-5)
  "finance.read", // ledger, journals, trial balance, financial accounts, finance audit trail
  "finance.transact", // draft journals, opening-balance drafts
  "finance.post", // post journals and opening balances
  "finance.reverse", // reverse / correct posted journals
  "finance.configure", // business settings & opening date, chart of accounts, mappings, financial accounts
  "finance.period_close", // soft-close / close / reopen periods; post into soft-closed periods
  "finance.reconcile", // run reconciliation checks, retry financial events
  "finance.approve_high_value", // approve a money movement at or above an account's approval threshold (Phase 3)
  "finance.sensitive", // ownership, partner and payroll balances (Phase 3) — OWNER only
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Only OWNER holds these. Everything else is granted to STAFF as well. */
export const OWNER_ONLY_PERMISSIONS = [
  "users.manage",
  "audit.read",
  "catalog.configure",
  "catalog.purge",
  "promotions.purge",
  "products.import",
  "ai.use",
  "orders.delete",
  "storefront.configure",
  "settings.manage",
  "ops.repair",
  "finance.read",
  "finance.transact",
  "finance.post",
  "finance.reverse",
  "finance.configure",
  "finance.period_close",
  "finance.reconcile",
  "finance.approve_high_value",
  "finance.sensitive",
] as const satisfies readonly Permission[];

const ownerOnly = new Set<Permission>(OWNER_ONLY_PERMISSIONS);

/** Finance roles: the books only. Configuration, period closing, high-value approvals and sensitive (ownership, partner,
 * payroll) data stay with OWNER. ACCOUNTANT records and reconciles but can't post — what they record waits for approval. */
const FINANCE_ADMIN_PERMISSIONS = ["finance.read", "finance.transact", "finance.post", "finance.reverse", "finance.reconcile"] as const satisfies readonly Permission[];
const ACCOUNTANT_PERMISSIONS = ["finance.read", "finance.transact", "finance.reconcile"] as const satisfies readonly Permission[];
const FINANCE_VIEWER_PERMISSIONS = ["finance.read"] as const satisfies readonly Permission[];

export const ROLE_PERMISSIONS: Readonly<Record<AdminRoleName, readonly Permission[]>> = Object.freeze({
  OWNER: Object.freeze([...PERMISSIONS]),
  STAFF: Object.freeze(PERMISSIONS.filter((p) => !ownerOnly.has(p))),
  FINANCE_ADMIN: Object.freeze([...FINANCE_ADMIN_PERMISSIONS]),
  ACCOUNTANT: Object.freeze([...ACCOUNTANT_PERMISSIONS]),
  FINANCE_VIEWER: Object.freeze([...FINANCE_VIEWER_PERMISSIONS]),
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
