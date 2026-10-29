/**
 * The one admin permission vocabulary and role → permission map (Phase 10, docs/PHASE_10_AUDIT.md). The API enforces it
 * (`requirePermission`); the web never re-derives it — it asks `can()` over the list `/api/auth/me` returns.
 *
 * The STAFF grant is the pre-Phase-10 OWNER/STAFF access (verified route by route) with the owner's decisions applied
 * (BUSINESS_DECISIONS): PD-10.1 made permanent coupon / category delete OWNER-only (`promotions.purge`, `catalog.purge`);
 * PD-10.2 kept refunds, manual payments, price and loyalty adjustments, SMS, exports and financial analytics with STAFF.
 * Any further change is an owner decision and a change to this map only.
 */
/** OWNER and STAFF run the store; MANAGER (admin audit phase 2) runs the store and the books without the owner's own
 * powers; FINANCE_ADMIN, ACCOUNTANT and FINANCE_VIEWER (Financial Core Phase 3, docs/FINANCE_PHASE_3.md §11) work in the
 * books only — they hold no commerce permission. */
export const ADMIN_ROLES = ["OWNER", "STAFF", "MANAGER", "FINANCE_ADMIN", "ACCOUNTANT", "FINANCE_VIEWER"] as const;
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
  "ai.use", // billed AI generation, the assistant's read tools and proposals
  "ai.execute", // confirm an AI proposal — the change runs as this admin (DR-23)
  // orders & money
  "orders.read",
  "orders.manage", // manual order, status, details, follow-up, partial-delivery reconcile
  "orders.cancel", // DR-5: cancelling moves stock and money — its own permission (OWNER and STAFF, owner 2026-10-08)
  "orders.adjust_price",
  "orders.export",
  "orders.delete", // delete / restore / permanent
  "orders.escalations", // decide on an escalated confirmation: one more try, phone fixed (Order Operations phase 3; OWNER + MANAGER)
  "payments.read",
  "payments.record", // manual payment
  "refunds.manage", // record / complete refunds
  "parcels.scan", // dispatch and return scanning — physical handover / receipt only, never stock (Order Operations phase 4)
  "returns.manage", // review returns & exchanges; receive a parcel back and inspect it (the step that restocks — D-OO1)
  "courier.manage",
  // courier cost reconciliation (docs/COURIER_COSTS.md): shipment charges and what customers paid the rider
  "courier_costs.read",
  "courier_costs.record", // enter / report charges and contributions, add return and replacement legs, refresh from the courier
  "courier_costs.verify", // verify charges and contributions, decide who bears an uncovered or excess amount, reconcile
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
  "inventory.approve", // a count loss over the limit (docs/STOCK_HUB.md §7) — OWNER only
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
  "finance.custody", // the cash a person holds (docs/FINANCE_OWNER_BOOKS.md §2): hand it over, confirm receiving it, count it, pay from it
  // purchasing, suppliers / AP and inventory costing (docs/FINANCE_PHASE_4.md §23)
  "suppliers.read",
  "suppliers.manage", // create / edit / hold suppliers
  "purchasing.read", // purchase orders, goods receipts, supplier returns
  "purchasing.manage", // draft / submit purchase orders and returns
  "purchasing.approve", // approve POs and returns, over-receipts, receipts without a PO
  "purchasing.receive", // post goods receipts, ship supplier returns (moves stock)
  "ap.read", // supplier invoices, payables, aging, statements
  "ap.manage", // draft invoices / credit notes, allocate payments
  "costing.read", // inventory valuation, average costs, cost movements
  "costing.adjust", // manual revaluation, valuation cutover
  // manufacturing (docs/MANUFACTURING.md)
  "manufacturing.read", // production orders, BOMs, materials, production costs and reports
  "manufacturing.manage", // draft production orders and BOMs, materials, cost entries, deliveries and inspections
  "manufacturing.approve", // approve orders, BOM versions, production costs, write-offs, over-receipts; close orders
  "manufacturing.move_stock", // issue / return materials, post production receipts (moves stock)
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
  "ai.execute",
  "orders.delete",
  // Phase 3 confirmation: STAFF makes the calls; an escalated order (unreachable, wrong number, too old) is decided above.
  "orders.escalations",
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
  // Phase 4: STAFF runs purchasing and receiving but never approves, sees payables or the valuation ledger.
  "purchasing.approve",
  "ap.read",
  "ap.manage",
  "costing.read",
  "costing.adjust",
  // Manufacturing: STAFF runs production (orders, materials, receiving) but never approves costs, write-offs or closes.
  "manufacturing.approve",
  // Courier costs: STAFF records what the rider / customer reported; verifying and reconciling stay with the owner and finance.
  "courier_costs.verify",
  // Stock: STAFF counts, but a count loss over the limit waits for the owner.
  "inventory.approve",
] as const satisfies readonly Permission[];

const ownerOnly = new Set<Permission>(OWNER_ONLY_PERMISSIONS);

/** Finance roles: the books only (and, from Phase 4, the purchasing documents the books rest on — never receiving stock). Configuration, period closing, high-value approvals and sensitive (ownership, partner,
 * payroll) data stay with OWNER. ACCOUNTANT records and reconciles but can't post — what they record waits for approval. */
const FINANCE_ADMIN_PERMISSIONS = [
  "finance.read", "finance.transact", "finance.post", "finance.reverse", "finance.reconcile", "finance.custody",
  "suppliers.read", "suppliers.manage", "purchasing.read", "purchasing.manage", "purchasing.approve", "ap.read", "ap.manage", "costing.read",
  "manufacturing.read", "manufacturing.manage", "manufacturing.approve",
  "courier_costs.read", "courier_costs.record", "courier_costs.verify",
] as const satisfies readonly Permission[];
const ACCOUNTANT_PERMISSIONS = [
  "finance.read", "finance.transact", "finance.reconcile", "finance.custody",
  "suppliers.read", "suppliers.manage", "purchasing.read", "ap.read", "ap.manage", "costing.read", "manufacturing.read",
  "courier_costs.read", "courier_costs.record", "courier_costs.verify",
] as const satisfies readonly Permission[];
const FINANCE_VIEWER_PERMISSIONS = ["finance.read", "suppliers.read", "purchasing.read", "ap.read", "costing.read", "manufacturing.read", "courier_costs.read"] as const satisfies readonly Permission[];

/** What a MANAGER never holds (owner, 2026-10-25): staff accounts, settings, partner / payroll money, closing a month, big
 * approvals, count losses over the limit, permanent deletes, repairs and confirming AI changes. Everything else — the
 * store and the books day to day — it does. */
export const MANAGER_EXCLUDED = [
  "users.manage",
  "settings.manage",
  "finance.sensitive",
  "finance.configure",
  "finance.period_close",
  "finance.approve_high_value",
  "ai.execute",
  "orders.delete",
  "catalog.purge",
  "promotions.purge",
  "ops.repair",
  "inventory.approve",
] as const satisfies readonly Permission[];
const managerExcluded = new Set<Permission>(MANAGER_EXCLUDED);

export const ROLE_PERMISSIONS: Readonly<Record<AdminRoleName, readonly Permission[]>> = Object.freeze({
  OWNER: Object.freeze([...PERMISSIONS]),
  STAFF: Object.freeze(PERMISSIONS.filter((p) => !ownerOnly.has(p))),
  MANAGER: Object.freeze(PERMISSIONS.filter((p) => !managerExcluded.has(p))),
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
