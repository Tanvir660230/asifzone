/**
 * The admin's business vocabulary (P1.5) — one user-facing label per concept, where the same thing had drifted into
 * several names across screens ("Return Requests" / "Return requests" / "Returns", "Promotions" / "Marketing", …).
 * A UI layer only: database models, API routes and enum values keep their names (e.g. the `CREDITED` payment status and
 * the `CustomerCredit` model stay as they are; staff call it "store credit", customers see "Store Balance").
 *
 * Navigation labels (lib/admin/navigation.ts) and new screens read from here; existing copy migrates as screens are
 * rebuilt (P2+), not in one sweep.
 */
export const TERMS = {
  dashboard: { singular: "Home", plural: "Home" },
  order: { singular: "Order", plural: "Orders" },
  returnRequest: { singular: "Return request", plural: "Return requests" },
  product: { singular: "Product", plural: "Products" },
  category: { singular: "Category", plural: "Categories" },
  /** Size / colour / … option sets products vary by — the `Attribute` model. */
  variantOption: { singular: "Variant option", plural: "Variant options" },
  /** Product types, templates, guides, SKU pattern — what each kind of product collects and shows. */
  catalogSetup: { singular: "Catalog setup", plural: "Catalog setup" },
  inventory: { singular: "Inventory", plural: "Inventory" },
  customer: { singular: "Customer", plural: "Customers" },
  /** Customer feedback + product reviews — one "Messages" module. */
  message: { singular: "Message", plural: "Messages" },
  review: { singular: "Review", plural: "Reviews" },
  /** Flash sales, coupons, bundles, campaigns — called "Promotions" before P1. */
  marketing: { singular: "Marketing", plural: "Marketing" },
  flashSale: { singular: "Flash sale", plural: "Flash sales" },
  coupon: { singular: "Coupon", plural: "Coupons" },
  bundle: { singular: "Bundle", plural: "Bundles" },
  campaign: { singular: "Campaign", plural: "Campaigns" },
  /** Homepage, banners, redirects, social links — called "Content" before P1. */
  storefront: { singular: "Storefront", plural: "Storefront" },
  banner: { singular: "Banner", plural: "Banners" },
  finance: { singular: "Finance", plural: "Finance" },
  payment: { singular: "Payment", plural: "Payments" },
  /** Business intelligence — the BI pages. */
  analytics: { singular: "Analytics", plural: "Analytics" },
  settings: { singular: "Settings", plural: "Settings" },
  administration: { singular: "Administration", plural: "Administration" },
  teamMember: { singular: "Team member", plural: "Team" },
  /** Staff-facing name of the `CustomerCredit` ledger / `CREDITED` status. */
  storeCredit: { singular: "Store credit", plural: "Store credit" },
  /** Customer-facing name of the same ledger (account area, receipts). */
  storeBalance: { singular: "Store Balance", plural: "Store Balance" },
} as const satisfies Record<string, { singular: string; plural: string }>;

export type Term = keyof typeof TERMS;

/** `term("order")` → "Orders"; `term("order", 1)` → "Order". */
export function term(key: Term, count?: number): string {
  return count === 1 ? TERMS[key].singular : TERMS[key].plural;
}
