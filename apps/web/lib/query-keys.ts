/**
 * Module-level React Query key factories (P1.11). The pattern is the Orders workspace's `orderKeys`
 * (components/admin/orders/order-domain.ts): each module owns ONE object, every key of the module is built by it, and a
 * module's broad keys are prefixes of its narrow ones — so `invalidateQueries({ queryKey: customerKeys.lists })` refreshes
 * every customers list page and filter at once, and no screen spells a key by hand.
 *
 * Keys keep the literals the app already used, so cached data and existing invalidations stay compatible while modules
 * migrate one at a time (P2+). New modules start here.
 */

export const customerKeys = {
  /** Every customers list (any page / search / filter). */
  lists: ["admin-customers"] as const,
  list: (params: Record<string, unknown>) => ["admin-customers", params] as const,
  stats: ["admin-customer-stats"] as const,
  detail: (id: string) => ["admin-customer", id] as const,
};

export const paymentKeys = {
  overview: ["payments-overview"] as const,
};

/** The shell's composite attention poll (hooks/use-attention-counts.ts) — invalidate it after anything that changes
 * a badge: an order command, a review moderated, feedback read, a notification read. */
export const attentionKeys = {
  all: ["attention"] as const,
};

/** The command palette's record search (components/admin/command-palette.tsx). */
export const paletteKeys = {
  all: ["palette"] as const,
  search: (entity: "orders" | "customers" | "products", query: string) => ["palette", entity, query] as const,
};
