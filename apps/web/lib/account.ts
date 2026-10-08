import type { Order } from "@clothing-brand/shared";

/**
 * The account's information architecture (docs/ACCOUNT_HOME.md): five sections, each a tab, some with sub-pages shown as
 * a second row of tabs. Every existing /account URL still works — it just lives under one of these sections now.
 */
export interface AccountSubPage {
  href: string;
  label: string;
}

export interface AccountSection {
  id: "home" | "orders" | "wallet" | "saved" | "settings";
  label: string;
  href: string;
  /** Pages that belong to this section; the first is the section's landing page. */
  pages: AccountSubPage[];
}

export const ACCOUNT_SECTIONS: AccountSection[] = [
  { id: "home", label: "Home", href: "/account", pages: [{ href: "/account", label: "Home" }] },
  {
    id: "orders",
    label: "Orders",
    href: "/account/orders",
    pages: [
      { href: "/account/orders", label: "Orders" },
      { href: "/account/returns", label: "Returns" },
    ],
  },
  {
    id: "wallet",
    label: "Wallet",
    href: "/account/store-balance",
    pages: [
      { href: "/account/store-balance", label: "Store balance" },
      { href: "/account/reward-points", label: "Points" },
      { href: "/account/coupons", label: "Coupons" },
    ],
  },
  {
    id: "saved",
    label: "Saved",
    href: "/account/saved",
    pages: [
      { href: "/account/saved", label: "Wishlist" },
      { href: "/account/browsing-history", label: "Recently viewed" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    href: "/account/settings",
    pages: [
      { href: "/account/settings", label: "Profile & security" },
      { href: "/account/addresses", label: "Addresses" },
    ],
  },
];

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The section and sub-page a URL belongs to — the longest matching page href wins, so /account/orders/123 is Orders and
 * /account itself is only Home. */
export function resolveAccountLocation(pathname: string): { section: AccountSection; page: AccountSubPage | null } {
  let best: { section: AccountSection; page: AccountSubPage } | null = null;
  for (const section of ACCOUNT_SECTIONS) {
    for (const page of section.pages) {
      if (!matches(pathname, page.href)) continue;
      if (page.href === "/account" && pathname !== "/account") continue;
      if (!best || page.href.length > best.page.href.length) best = { section, page };
    }
  }
  return best ?? { section: ACCOUNT_SECTIONS[0]!, page: null };
}

/* ─────────────────────────── Order progress, in the customer's words ─────────────────────────── */

export const ORDER_PROGRESS_STEPS: { status: Order["status"]; label: string }[] = [
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "PROCESSING", label: "Preparing" },
  { status: "PACKED", label: "Packed" },
  { status: "SHIPPED", label: "Shipped" },
  { status: "DELIVERED", label: "Delivered" },
];

/** Index of the last completed step, or -1 before confirmation (PENDING). Null for statuses off the happy path. */
export function orderProgressIndex(status: Order["status"]): number | null {
  if (status === "PENDING") return -1;
  const i = ORDER_PROGRESS_STEPS.findIndex((s) => s.status === status);
  return i === -1 ? null : i;
}

const HEADLINES: Partial<Record<Order["status"], { title: string; detail: string }>> = {
  PENDING: { title: "Waiting for confirmation", detail: "We'll confirm your order shortly, usually by phone or SMS." },
  CONFIRMED: { title: "Confirmed", detail: "Your order is confirmed and will be prepared next." },
  PROCESSING: { title: "Being prepared", detail: "We're getting your items ready." },
  PACKED: { title: "Packed and ready to ship", detail: "It goes to the courier next." },
  SHIPPED: { title: "On its way", detail: "Your parcel is with the courier." },
  DELIVERED: { title: "Delivered", detail: "Your order has arrived." },
  PARTIALLY_DELIVERED: { title: "Partly delivered", detail: "Part of this order was delivered; we're sorting out the rest." },
  CANCELLED: { title: "Cancelled", detail: "This order was cancelled." },
  RETURNED: { title: "Returned", detail: "This order came back to us." },
  REFUNDED: { title: "Refunded", detail: "This order has been refunded." },
};

export function orderHeadline(status: Order["status"]): { title: string; detail: string } {
  return HEADLINES[status] ?? { title: status, detail: "" };
}

/** Return request status, in the customer's words. */
export const RETURN_STATUS_LABEL: Record<string, string> = {
  PENDING: "Under review",
  APPROVED: "Approved",
  REJECTED: "Not approved",
};

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Morning / afternoon / evening, from the viewer's clock. */
export function partOfDay(date: Date = new Date()): "morning" | "afternoon" | "evening" {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  return "evening";
}
