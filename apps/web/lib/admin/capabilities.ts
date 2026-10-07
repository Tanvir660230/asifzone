import type { Permission } from "@clothing-brand/shared";

/**
 * The admin action registry (P1.3) — every UI capability the admin checks, named once. A capability maps onto the
 * existing server permission vocabulary (@clothing-brand/shared permissions.ts) and, for provider-backed actions, the
 * Phase 12 D-4 provider availability. It is NOT a second permission model: the API enforces every permission itself, and
 * this registry only decides what the UI offers (hidden rather than shown-then-403'd).
 *
 * Components ask `useCapability("orders.manage")` (hooks/use-capability.ts), or `can(...)` below with explicit context —
 * never `admin.role === …` and never a local permission table.
 */

/** Provider kinds an action can depend on — the keys of the API's provider capability report. */
export type ProviderRequirement = "courier" | "sms" | "email" | "push";

export interface CapabilityDefinition {
  /** The server permission the action needs. Omitted for actions every signed-in admin has. */
  permission?: Permission;
  /** A provider that must be usable on this deployment (Phase 12 D-4) — otherwise the action is not offered. */
  provider?: ProviderRequirement;
}

export const CAPABILITIES = {
  "dashboard.view": {},
  // orders & money
  "orders.view": { permission: "orders.read" },
  "orders.manage": { permission: "orders.manage" },
  "orders.adjustPrice": { permission: "orders.adjust_price" },
  "orders.export": { permission: "orders.export" },
  "orders.trash": { permission: "orders.delete" },
  "payments.view": { permission: "payments.read" },
  "payments.record": { permission: "payments.record" },
  "refunds.manage": { permission: "refunds.manage" },
  "returns.manage": { permission: "returns.manage" },
  "courier.manage": { permission: "courier.manage", provider: "courier" },
  // catalog & stock
  "catalog.view": { permission: "catalog.read" },
  "catalog.manage": { permission: "catalog.manage" },
  "catalog.configure": { permission: "catalog.configure" },
  "products.import": { permission: "products.import" },
  "inventory.view": { permission: "inventory.read" },
  "inventory.adjust": { permission: "inventory.adjust" },
  // customers & messages
  "customers.view": { permission: "customers.read" },
  "customers.manage": { permission: "customers.manage" },
  "customers.message": { permission: "customers.message" },
  "content.manage": { permission: "content.manage" },
  // growth
  "promotions.manage": { permission: "promotions.manage" },
  "campaigns.manage": { permission: "campaigns.manage" },
  "storefront.configure": { permission: "storefront.configure" },
  // insight
  "analytics.view": { permission: "analytics.read" },
  "ai.use": { permission: "ai.use" },
  // administration
  "settings.manage": { permission: "settings.manage" },
  "team.manage": { permission: "users.manage" },
  "audit.view": { permission: "audit.read" },
  "ops.view": { permission: "ops.read" },
  "ops.repair": { permission: "ops.repair" },
} as const satisfies Record<string, CapabilityDefinition>;

export type Capability = keyof typeof CAPABILITIES;

export function isCapability(value: string): value is Capability {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, value);
}

export interface CapabilityContext {
  /** The signed-in admin's permissions (from /api/auth/me); null/undefined while loading → nothing is allowed. */
  permissions: readonly Permission[] | null | undefined;
  /** Which providers are usable (hooks/use-provider-capabilities.ts). Missing → provider-backed actions are unavailable. */
  providers?: Partial<Record<ProviderRequirement, boolean>>;
}

/** Pure capability check — same answer the hook gives, usable outside React and in tests. */
export function can(capability: Capability, context: CapabilityContext): boolean {
  const definition: CapabilityDefinition = CAPABILITIES[capability];
  if (!context.permissions) return false;
  if (definition.permission && !context.permissions.includes(definition.permission)) return false;
  if (definition.provider && !context.providers?.[definition.provider]) return false;
  return true;
}
