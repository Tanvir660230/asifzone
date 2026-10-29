import type { Capability } from "./capabilities";
import type { FeatureFlag } from "./features";
import { PRODUCT_NEW_HREF } from "@/lib/admin-routes";
import { term } from "./terminology";

/**
 * The admin navigation manifest (P1.1) — the ONE source of truth for where every admin page lives. The sidebar (expanded,
 * collapsed flyout, mobile drawer and bottom bar), the in-page section tabs, the command palette, the Create menu,
 * breadcrumbs, document titles, active state, capability / feature-flag visibility, `g`-chord go-to shortcuts and
 * deprecated-route redirects are all DERIVED from `NAV_NODES` below. Do not add a second route list anywhere; add a node.
 *
 * Pure data and pure functions (icons are referenced by name; components/admin/nav-icons.tsx maps them), so the
 * middleware, the architecture tests and the UI all import the same thing.
 *
 * Shape: module → page → tab, at most three levels. A module with pages expands in the sidebar (one level); a page with
 * pages of its own shows them as in-page tabs (e.g. Products › Catalog setup › Product types).
 */

export type NavKind = "module" | "page" | "report" | "settings" | "create" | "detail";
export type NavDomain = "home" | "operate" | "stock" | "grow" | "manage" | "system";
export type NavIconName =
  | "home"
  | "orders"
  | "products"
  | "inventory"
  | "customers"
  | "messages"
  | "marketing"
  | "storefront"
  | "finance"
  | "analytics"
  | "settings"
  | "administration"
  | "books"
  | "reports";
/** Something a store does, read from its own data (owner decision Q-G): GET /api/v1/admin/store-capabilities. */
export type StoreCapability = "production";

/** Work-queue counts a node may show — resolved by the shell from the dashboard's attention counts. */
export type NavBadgeSource = "orders" | "messages" | "inbox" | "reviews" | "finance";

export interface NavCommand {
  id: string;
  label: string;
  hint?: string;
  route: string;
  capability?: Capability;
  /** `create` commands make up the Create menu and the palette's Create group. */
  kind: "create";
  keywords?: string[];
}

export interface NavNode {
  id: string;
  label: string;
  kind: NavKind;
  /** The page's route (Next.js pattern, `[param]` segments allowed). Omitted on a module that only groups pages. */
  route?: string;
  /** Parent node id. Modules have none. */
  parent?: string;
  domain: NavDomain;
  /** Where clicking this node goes when it has no route of its own (a module / grouping page): one of its descendants. */
  index?: string;
  /** Extra pathname prefixes that count as "inside" this node for active state (routes outside its own prefix). */
  activeFor?: string[];
  icon?: NavIconName;
  /** What the admin must be able to do to see it (lib/admin/capabilities.ts). The API still enforces the page's calls. */
  capability?: Capability;
  /** Hidden unless this admin feature is switched on for the installation (lib/admin/features.ts). */
  featureFlag?: FeatureFlag;
  /** Hidden unless the store's own data shows it does this (Q-G: Production only where production exists). */
  storeCapability?: StoreCapability;
  badge?: NavBadgeSource;
  keywords?: string[];
  /** Sort order among siblings. */
  order: number;
  /** Label under the icon in the collapsed sidebar rail and the mobile tab bar, when `label` is too long for them. */
  shortLabel?: string;
  /** Breadcrumb label when it differs from `label`. */
  breadcrumb?: string;
  /** Document / page title when it differs from `label`. */
  title?: string;
  /** One plain sentence on what the page is for — the Finance overview's map of pages lists it under the label. */
  description?: string;
  /** `hidden`: resolvable (title, breadcrumbs, active state) but never listed in navigation. Default `nav`. */
  visibility?: "nav" | "hidden";
  /** `primary`: one of the mobile bottom-bar destinations. */
  mobile?: "primary";
  /** Listed in the command palette's page results. Default: true for static, listed routes. */
  search?: boolean;
  commands?: NavCommand[];
  /** Second key of the `g` go-to chord (`g o` → Orders). Modules only. */
  goKey?: string;
  /** Old routes that now live here — the middleware redirects them (query string kept). Same `[param]` names as `route`. */
  deprecatedRoutes?: string[];
  /** A grouping page whose pages show as a vertical inner list beside the page on wide screens (macOS Settings-style)
   * instead of a tab row — for long sets like Catalog setup's ten. Its layout renders <InnerNav>. */
  innerList?: boolean;
}

/** The sidebar's groups (ERP UI plan, tab 21 §2): Home; Sell; Make & stock; Grow; Money; Settings in the footer. */
export const NAV_DOMAINS: ReadonlyArray<{ id: NavDomain; label: string | null }> = [
  { id: "home", label: null },
  { id: "operate", label: "Sell" },
  { id: "stock", label: "Make & stock" },
  { id: "grow", label: "Grow" },
  { id: "manage", label: "Money" },
  { id: "system", label: null }, // the sidebar footer
];

/** The ceiling on top-level modules — a guard test enforces it. */
export const MAX_PRIMARY_MODULES = 12;
export const MAX_NAV_DEPTH = 3;

/** Analytics (Blueprint V2 DR-26): six tabs; each folds in the BI pages it replaced, whose old paths redirect to the
 * tab's view (`?view=`). */
const ANALYTICS_TABS: Array<[slug: string, label: string, keywords: string[], deprecated: string[]]> = [
  ["overview", "Overview", ["analytics", "reports", "export", "ai insights", "lifetime", "ltv"], ["/admin/bi/overview", "/admin/bi/ai-insights?view=insights", "/admin/bi/lifetime?view=lifetime", "/admin/bi/reports?reports=1"]],
  ["sales", "Sales", ["revenue", "sales analytics", "profit", "margin", "cogs", "financial"], ["/admin/bi/sales", "/admin/bi/financial?view=financial"]],
  ["products", "Products", ["product analytics", "stock turnover", "inventory intel", "search", "queries", "zero results"], ["/admin/bi/products", "/admin/bi/inventory?view=inventory", "/admin/bi/search?view=search"]],
  ["customers", "Customers", ["cohort", "retention", "rfm", "customer analytics", "behavior", "heatmap"], ["/admin/bi/customers", "/admin/bi/behavior?view=behavior"]],
  ["marketing", "Marketing", ["campaign", "traffic", "marketing analytics", "visitors", "devices", "journey", "funnel", "conversion"], ["/admin/bi/marketing", "/admin/bi/visitors?view=visitors", "/admin/bi/journey?view=journey"]],
  ["operations", "Operations", ["fulfilment", "courier performance"], ["/admin/bi/operations"]],
];

const CATALOG_SETUP: Array<[slug: string, label: string, keywords?: string[]]> = [
  ["types", "Product types"],
  ["templates", "Templates"],
  ["attributes", "Product fields", ["attributes", "fields", "specifications"]],
  ["size-guides", "Size guides", ["size chart"]],
  ["care-guides", "Care guides"],
  ["materials", "Fabrics", ["fabric", "materials"]],
  ["sku", "SKUs", ["sku pattern"]],
  ["sections", "Page sections"],
  ["spec-groups", "Spec groups", ["specifications"]],
  ["search-synonyms", "Search synonyms", ["synonym"]],
  ["courier-notes", "Courier notes", ["courier", "parcel note", "steadfast note", "fragile"]],
];

export const NAV_NODES: readonly NavNode[] = [
  // ── Home ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "home",
    label: "Dashboard",
    breadcrumb: term("dashboard"),
    kind: "module",
    route: "/admin/dashboard",
    domain: "home",
    icon: "home",
    capability: "dashboard.view",
    order: 0,
    mobile: "primary",
    goKey: "h",
    keywords: ["home", "overview"],
  },

  // ── Operate ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "orders",
    label: term("order"),
    kind: "module",
    domain: "operate",
    index: "/admin/orders",
    activeFor: ["/admin/orders", "/admin/return-requests"],
    icon: "orders",
    capability: "orders.view",
    badge: "orders",
    order: 10,
    mobile: "primary",
    goKey: "o",
    commands: [{ id: "create.order", kind: "create", label: "New order", hint: "Manual / phone order", route: "/admin/orders/new", capability: "orders.manage" }],
  },
  { id: "orders.all", label: "All orders", title: term("order"), kind: "page", parent: "orders", domain: "operate", route: "/admin/orders", capability: "orders.view", order: 0 },
  // Blueprint P1.5 / tab 2 §2: a saved view of All orders (the list's `view` param is active / trash, so it is the queue).
  { id: "orders.ready", label: "Ready to ship", kind: "page", parent: "orders", domain: "operate", route: "/admin/orders/ready", capability: "orders.view", order: 0.5, keywords: ["packed", "to ship", "courier pickup"] },
  {
    id: "orders.returns",
    // blueprint tab 2 §2: customers' requests and parcels on their way back, as two tabs of one page
    label: "Returns & refused parcels",
    shortLabel: "Returns",
    kind: "page",
    parent: "orders",
    domain: "operate",
    route: "/admin/return-requests",
    capability: "orders.view",
    order: 1,
    keywords: ["exchange", "refund", "returns", "return requests", "refused parcel", "receive parcel"],
  },
  { id: "orders.new", label: "New order", kind: "create", parent: "orders", domain: "operate", route: "/admin/orders/new", capability: "orders.manage", order: 2, visibility: "hidden" },
  { id: "orders.print-labels", label: "Print labels", kind: "page", parent: "orders", domain: "operate", route: "/admin/orders/print-labels", capability: "orders.view", order: 3, visibility: "hidden" },
  { id: "orders.detail", label: term("order", 1), kind: "detail", parent: "orders", domain: "operate", route: "/admin/orders/[id]", capability: "orders.view", order: 4, visibility: "hidden" },

  {
    id: "products",
    label: term("product"),
    kind: "module",
    domain: "stock",
    index: "/admin/products",
    activeFor: ["/admin/products", "/admin/categories", "/admin/attributes", "/admin/catalog"],
    icon: "products",
    order: 20,
    goKey: "p",
    keywords: ["catalog"],
    commands: [{ id: "create.product", kind: "create", label: "New product", hint: "Product Builder", route: PRODUCT_NEW_HREF, capability: "catalog.manage" }],
  },
  { id: "products.all", label: "All products", title: term("product"), kind: "page", parent: "products", domain: "stock", route: "/admin/products", capability: "catalog.view", order: 0 },
  { id: "products.categories", label: term("category"), kind: "page", parent: "products", domain: "stock", route: "/admin/categories", capability: "catalog.view", order: 1 },
  {
    id: "products.variant-options",
    label: term("variantOption"),
    kind: "page",
    parent: "products",
    domain: "stock",
    route: "/admin/attributes",
    capability: "catalog.view",
    order: 2,
    keywords: ["size", "colour", "color", "attributes"],
  },
  { id: "products.import", label: "Import / export", kind: "page", parent: "products", domain: "stock", route: "/admin/products/import", capability: "catalog.view", order: 3, keywords: ["csv"] },
  {
    id: "products.catalog-setup",
    label: term("catalogSetup"),
    kind: "settings",
    parent: "products",
    domain: "stock",
    route: "/admin/catalog",
    index: "/admin/catalog/types",
    capability: "catalog.view",
    order: 4,
    innerList: true,
    keywords: ["types", "templates", "attributes", "size guide"],
  },
  ...CATALOG_SETUP.map(
    ([slug, label, keywords], i): NavNode => ({
      id: `products.catalog-setup.${slug}`,
      label,
      kind: "settings",
      parent: "products.catalog-setup",
      domain: "stock",
      route: `/admin/catalog/${slug}`,
      capability: "catalog.view",
      order: i,
      keywords,
    }),
  ),
  {
    id: "products.new",
    label: "Add product",
    breadcrumb: "New product",
    kind: "create",
    parent: "products",
    domain: "stock",
    route: PRODUCT_NEW_HREF,
    capability: "catalog.manage",
    order: 5,
    visibility: "hidden",
    deprecatedRoutes: ["/admin/products/wizard/new"],
  },
  {
    id: "products.edit",
    label: "Edit product",
    kind: "detail",
    parent: "products",
    domain: "stock",
    route: "/admin/products/[id]/edit",
    capability: "catalog.view",
    order: 6,
    visibility: "hidden",
    deprecatedRoutes: ["/admin/products/wizard/[id]/edit"],
  },

  // Inventory groups stock with production (docs/MANUFACTURING.md): materials, bills of materials and production orders
  // are the stock that is made rather than bought — kept within the 12 primary modules.
  { id: "inventory", label: "Stock", kind: "module", index: "/admin/stock", activeFor: ["/admin/manufacturing", "/admin/stock", "/admin/inventory"], domain: "stock", icon: "inventory", order: 30, mobile: "primary", goKey: "i", keywords: ["stock", "production", "manufacturing"] },
  // The stock hub (docs/STOCK_HUB.md §7): Today, then every item — first, the page the owner works from.
  { id: "inventory.hub", label: "Stock", kind: "page", parent: "inventory", domain: "stock", route: "/admin/stock", capability: "inventory.view", order: 0, deprecatedRoutes: ["/admin/finance/refills?open=filled"], keywords: ["stock", "today", "received goods", "bought", "purchase", "reorder", "filled bottles", "refill", "attar", "count", "counted", "approve", "materials", "oil", "bottle", "caps"] },
  // Blueprint tab 2 §2: every purchase, both paths, in one list (the formal documents stay under More)
  { id: "inventory.purchases", label: "Purchases", kind: "page", parent: "inventory", domain: "stock", route: "/admin/stock/purchases", capability: "purchasing.view", order: 1, description: "Everything bought, however it was entered, with possible duplicates flagged.", keywords: ["purchases", "bought", "received goods", "duplicate", "grn"] },
  { id: "inventory.stock", label: "History & adjustments", title: "Stock history & adjustments", kind: "page", parent: "inventory", domain: "stock", route: "/admin/inventory", capability: "inventory.view", order: 4, keywords: ["stock", "adjust", "movements", "levels", "write off"] },
  // Stock › More: the formal purchasing path and the books-side stock pages (tab 2 §2) — owners and purchasing roles.
  { id: "inventory.more", label: "More", title: "More stock pages", kind: "page", parent: "inventory", domain: "stock", index: "/admin/finance/purchase-orders", order: 5, innerList: true, keywords: ["purchase orders", "goods receipts", "supplier returns", "landed costs", "packaging", "stock check"] },
  // Production is one sidebar entry; its pages are tabs on it (the stock page covers day-to-day attar filling).
  { id: "inventory.production", storeCapability: "production", label: "Production", kind: "page", parent: "inventory", domain: "stock", index: "/admin/manufacturing/home", capability: "manufacturing.view", order: 3, keywords: ["manufacturing", "production"] },
  // Production home (docs/STOCK_HUB.md §9): bought, filled, recipes, price & profit — and what the materials can still make.
  // Blueprint P1.8: one Production page — Home absorbed the Overview; its old URL redirects here.
  { id: "inventory.production-home", label: "Home", title: "Production", breadcrumb: "Home", kind: "page", parent: "inventory.production", domain: "stock", route: "/admin/manufacturing/home", capability: "manufacturing.view", order: -1, deprecatedRoutes: ["/admin/manufacturing"], keywords: ["production", "can still make", "fill", "owed", "bottles", "low materials", "manufacturing", "wip", "work in progress", "producer performance", "yield"] },
  { id: "inventory.production-orders", label: "Production runs", kind: "page", parent: "inventory.production", domain: "stock", route: "/admin/manufacturing/production-orders", capability: "manufacturing.view", order: 1, keywords: ["manufacturing", "factory", "mo", "make", "produce"] },
  { id: "inventory.production-order-detail", label: "Production run", kind: "detail", parent: "inventory", domain: "stock", route: "/admin/manufacturing/production-orders/[id]", capability: "manufacturing.view", order: 3, visibility: "hidden" },
  { id: "inventory.boms", label: "Recipes", kind: "page", parent: "inventory.production", domain: "stock", route: "/admin/manufacturing/boms", capability: "manufacturing.view", order: 2, keywords: ["bom", "bill of materials", "recipe", "materials per unit"] },
  { id: "inventory.materials", label: "Materials", kind: "page", parent: "inventory.production", domain: "stock", route: "/admin/manufacturing/materials", capability: "manufacturing.view", order: 3, keywords: ["raw materials", "oil", "bottle", "box", "sticker", "fabric", "trims", "packaging", "purchase unit", "litre", "dozen"] },

  {
    id: "customers",
    label: term("customer"),
    kind: "module",
    route: "/admin/customers",
    domain: "operate",
    icon: "customers",
    capability: "customers.view",
    order: 40,
    goKey: "c",
    keywords: ["crm"],
    commands: [{ id: "create.customer", kind: "create", label: "New customer", hint: term("customer"), route: "/admin/customers", capability: "customers.manage" }],
  },
  { id: "customers.detail", label: term("customer", 1), kind: "detail", parent: "customers", domain: "operate", route: "/admin/customers/[id]", capability: "customers.view", order: 0, visibility: "hidden" },

  {
    id: "messages",
    label: "Inbox",
    kind: "module",
    domain: "operate",
    index: "/admin/feedback",
    activeFor: ["/admin/feedback", "/admin/saved-answers", "/admin/reviews"],
    icon: "messages",
    badge: "messages",
    order: 35,
    mobile: "primary",
    goKey: "e",
    keywords: ["support", "feedback"],
  },
  { id: "messages.feedback", label: "Conversations", kind: "page", parent: "messages", domain: "operate", route: "/admin/feedback", capability: "content.manage", badge: "inbox", order: 0, keywords: ["support", "messages", "feedback", "contact form", "reply"] },
  {
    id: "messages.answers",
    label: "Saved answers",
    kind: "page",
    parent: "messages",
    domain: "operate",
    route: "/admin/saved-answers",
    capability: "content.manage",
    order: 1,
    keywords: ["auto reply", "faq", "learned", "quick reply", "templates"],
  },
  { id: "messages.reviews", label: "Reviews to approve", kind: "page", parent: "messages", domain: "operate", route: "/admin/reviews", capability: "content.manage", badge: "reviews", order: 2, keywords: ["reviews", "ratings"] },

  // ── Grow ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "marketing",
    label: term("marketing"),
    kind: "module",
    domain: "grow",
    index: "/admin/flash-sales",
    activeFor: ["/admin/flash-sales", "/admin/coupons", "/admin/bundles", "/admin/campaigns", "/admin/finance/ads", "/admin/marketing"],
    icon: "marketing",
    order: 60,
    goKey: "m",
    keywords: ["promotions", "discount"],
    commands: [
      { id: "create.coupon", kind: "create", label: "New coupon", hint: term("marketing"), route: "/admin/coupons", capability: "promotions.manage" },
      { id: "create.flash-sale", kind: "create", label: "New flash sale", hint: term("marketing"), route: "/admin/flash-sales", capability: "promotions.manage" },
    ],
  },
  // Blueprint P2.5: every published product's one-page order form for ads (/lp/<slug>)
  { id: "marketing.landing-pages", label: "Landing pages", kind: "page", parent: "marketing", domain: "grow", route: "/admin/marketing/landing-pages", capability: "promotions.manage", order: -0.5, keywords: ["lp", "landing page", "ad link", "facebook ad", "order form"] },
  { id: "marketing.flash-sales", label: term("flashSale"), kind: "page", parent: "marketing", domain: "grow", route: "/admin/flash-sales", capability: "promotions.manage", order: 0 },
  { id: "marketing.coupons", label: term("coupon"), kind: "page", parent: "marketing", domain: "grow", route: "/admin/coupons", capability: "promotions.manage", order: 1, keywords: ["discount code"] },
  { id: "marketing.bundles", label: term("bundle"), kind: "page", parent: "marketing", domain: "grow", route: "/admin/bundles", capability: "promotions.manage", order: 2 },
  { id: "marketing.campaigns", label: "SMS campaigns", kind: "page", parent: "marketing", domain: "grow", route: "/admin/campaigns", capability: "promotions.manage", order: 3, keywords: ["sms"] },

  {
    id: "storefront",
    label: "Online store",
    kind: "module",
    domain: "grow",
    index: "/admin/homepage",
    activeFor: ["/admin/homepage", "/admin/banners", "/admin/social-links", "/admin/redirects"],
    icon: "storefront",
    order: 70,
    goKey: "w",
    keywords: ["content", "homepage"],
    commands: [{ id: "create.banner", kind: "create", label: "New banner", hint: term("storefront"), route: "/admin/banners", capability: "content.manage" }],
  },
  { id: "storefront.homepage", label: "Homepage", kind: "page", parent: "storefront", domain: "grow", route: "/admin/homepage", order: 0, keywords: ["sections", "content"] },
  { id: "storefront.banners", label: term("banner"), kind: "page", parent: "storefront", domain: "grow", route: "/admin/banners", order: 1 },
  { id: "storefront.social-links", label: "Social links", kind: "page", parent: "storefront", domain: "grow", route: "/admin/social-links", order: 2 },
  { id: "storefront.redirects", label: "Redirects", kind: "page", parent: "storefront", domain: "grow", route: "/admin/redirects", order: 3, keywords: ["seo", "301"] },

  // ── Manage ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "finance",
    label: "Money",
    kind: "module",
    domain: "manage",
    index: "/admin/finance",
    activeFor: ["/admin/payments", "/admin/finance"],
    icon: "finance",
    order: 80,
    goKey: "f",
    badge: "finance",
    keywords: ["payments", "refund", "gateway", "money", "profit", "accounts"],
    commands: [
      { id: "create.expense", kind: "create", label: "Record expense", hint: term("finance"), route: "/admin/finance/expenses?new=expense", capability: "finance.transact" },
      { id: "create.money-in", kind: "create", label: "Money in (deposit)", hint: term("finance"), route: "/admin/finance/accounts?new=deposit", capability: "finance.transact" },
      { id: "create.money-out", kind: "create", label: "Money out (withdrawal)", hint: term("finance"), route: "/admin/finance/accounts?new=withdrawal", capability: "finance.transact" },
      { id: "create.purchase-order", kind: "create", label: "New purchase order", hint: "Purchasing", route: "/admin/finance/purchase-orders?new=purchase-order", capability: "purchasing.manage" },
      { id: "create.supplier-bill", kind: "create", label: "New supplier bill", hint: "Purchasing", route: "/admin/finance/supplier-invoices?new=bill", capability: "ap.manage" },
    ],
  },
  // Finance IA (2026-10-12 reorganisation): Overview → Needs attention → six groups, ordered by how often an owner needs
  // them — Money, Sales & payments, Purchasing, Reports & books, Payroll & partners, Setup & checks. Every group is an
  // inner list beside the page on wide screens (tabs on phones). A group's capability matches its index page, so it never
  // links a role to a page it can't open. `description` feeds the Overview's map of every finance page.
  {
    id: "finance.home",
    label: "Overview",
    title: "Money",
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance",
    capability: "finance.view",
    order: -2,
    description: "How the month is going, where the money is and who is owed what.",
    keywords: ["finance home", "summary", "cash", "profit", "owed"],
  },
  {
    id: "finance.attention",
    label: "Needs attention",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/attention",
    capability: "finance.view",
    order: 0,
    // Blueprint P1.1 / P1.6: every alert is on Home, the close on Books › Month-end — the old page only forwards.
    visibility: "hidden",
    description: "Problems in the books that need you, and the month-end close checklist.",
    keywords: ["alerts", "to do", "overdue", "month end", "close the month", "checklist", "period close"],
  },
  {
    id: "finance.my-cash",
    label: "My cash",
    kind: "page",
    parent: "finance.money",
    domain: "manage",
    route: "/admin/finance/my-cash",
    capability: "finance.custody",
    order: -1,
    description: "The cash you hold: hand it over, confirm what you received, count it and pay from it.",
    keywords: ["handover", "cash in hand", "manager cash", "cash count", "petty cash"],
  },
  {
    id: "finance.money",
    label: "Accounts & cash",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/finance/accounts",
    order: 1,
    innerList: true,
    description: "Your cash, bank and bKash/Nagad balances, and the money you spend or borrow.",
    keywords: ["cash", "bank", "bkash", "expenses", "loans"],
  },
  {
    id: "finance.selling",
    label: "Payments & refunds",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/payments/transactions",
    order: 4,
    innerList: true,
    description: "Money customers paid, refunds, and what couriers and gateways still owe you.",
    keywords: ["payments", "cod", "courier", "gateway", "refunds", "settlements"],
  },

  // Money
  {
    id: "finance.accounts",
    label: "Money accounts",
    kind: "page",
    parent: "finance.money",
    domain: "manage",
    route: "/admin/finance/accounts",
    capability: "finance.view",
    order: 0,
    description: "Each cash box, bank and wallet with its balance; record money in, out or transfers.",
    keywords: ["cash", "bank", "bkash", "nagad", "wallet", "transfer", "deposit", "withdrawal"],
  },
  { id: "finance.account-detail", label: "Money account", kind: "detail", parent: "finance.money", domain: "manage", route: "/admin/finance/accounts/[id]", capability: "finance.view", order: 0, visibility: "hidden" },
  {
    id: "finance.expenses",
    label: "Expenses",
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance/expenses",
    capability: "finance.view",
    order: 2,
    description: "Rent, bills, ads and other spending, plus fixed monthly costs.",
    keywords: ["expense", "rent", "salary", "subscription", "recurring", "fixed costs", "break-even"],
  },
  {
    id: "finance.loans",
    label: "Loans",
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance/loans",
    capability: "finance.view",
    order: 6,
    description: "Money you borrowed, instalments due and interest.",
    keywords: ["loan", "borrowing", "interest", "emi", "instalment", "repayment"],
  },
  {
    id: "finance.reconciliation",
    label: "Bank reconciliation",
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance/reconciliation",
    capability: "finance.view",
    order: 8,
    description: "Match your bank statement against the books line by line.",
    keywords: ["statement", "reconcile", "csv import"],
  },
  { id: "finance.reconciliation-detail", label: "Reconciliation", kind: "detail", parent: "finance", domain: "manage", route: "/admin/finance/reconciliation/[id]", capability: "finance.view", order: 3, visibility: "hidden" },
  {
    id: "finance.prepaid",
    label: "Prepaid costs",
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance/prepaid",
    capability: "finance.view",
    order: 7,
    description: "Hosting, domain, rent paid in advance — used up month by month, with renewal dates.",
    keywords: ["prepaid", "domain", "hosting", "server", "advance rent", "subscription", "renewal", "amortisation"],
  },
  {
    id: "finance.ads",
    label: "Ads",
    title: "Ad spend", kind: "page",
    parent: "marketing",
    domain: "grow",
    route: "/admin/finance/ads",
    capability: "finance.view",
    order: -1,
    description: "Every campaign's daily spend from Meta or its budget, the orders it brought and profit after ads.",
    keywords: ["facebook ads", "meta", "boost", "campaign", "budget", "roas", "marketing", "tiktok ads"],
  },

  // Bills to pay
  { id: "finance.bills", label: "Bills to pay", kind: "page", parent: "finance", domain: "manage", index: "/admin/finance/supplier-invoices", order: 3, innerList: true, description: "Supplier bills and what you owe each supplier.", keywords: ["supplier bills", "dues", "payables", "pay supplier"] },
  // Courier & gateway money in one place (tab 2 §6)
  { id: "finance.courier-gateway", label: "Courier & gateway", kind: "page", parent: "finance", domain: "manage", index: "/admin/finance/settlements", order: 5, innerList: true, description: "Steadfast and gateway payouts, the Steadfast check and what each parcel cost.", keywords: ["steadfast", "payouts", "courier costs", "settlements"] },

  // Payments & refunds
  {
    id: "finance.transactions",
    label: "Customer payments",
    kind: "page",
    parent: "finance.selling",
    domain: "manage",
    route: "/admin/payments/transactions",
    capability: "payments.view",
    order: 0,
    description: "Every payment customers made — bKash, card, cash on delivery.",
    keywords: ["transactions", "payments received", "bkash", "cod collected", "ledger"],
  },
  {
    id: "finance.refunds",
    label: "Refunds",
    kind: "page",
    parent: "finance.selling",
    domain: "manage",
    route: "/admin/payments/refunds",
    capability: "payments.view",
    order: 1,
    description: "Money returned to customers.",
    keywords: ["refund", "money back"],
  },
  {
    id: "finance.settlements",
    label: "Payouts",
    title: "Courier & gateway payouts",
    kind: "page",
    parent: "finance.courier-gateway",
    domain: "manage",
    route: "/admin/finance/settlements",
    capability: "finance.view",
    order: 2,
    description: "Cash-on-delivery money from couriers and payouts from gateways, with their fees.",
    keywords: ["settlements", "cod", "courier", "steadfast", "gateway", "clearing", "payout", "fees"],
  },
  {
    id: "finance.courier",
    label: "Steadfast check",
    kind: "page",
    parent: "finance.courier-gateway",
    domain: "manage",
    route: "/admin/finance/courier",
    capability: "finance.view",
    order: 2.5,
    description: "What Steadfast owes you vs its own balance, payouts to import, parcels stuck or unpaid.",
    keywords: ["steadfast", "courier balance", "cod receivable", "payout import", "lost parcel", "partial delivery", "courier charges"],
  },
  {
    id: "finance.courier-costs",
    label: "Costs",
    title: "Courier costs",
    kind: "page",
    parent: "finance.courier-gateway",
    domain: "manage",
    route: "/admin/finance/courier-costs",
    capability: "courierCosts.view",
    order: 2.6,
    description: "What each parcel really cost, what customers paid riders on returns and exchanges, and what's left uncovered.",
    keywords: ["courier cost", "return charge", "exchange", "refused parcel", "rider", "delivery charge", "uncovered", "partial", "reconcile shipment"],
  },
  {
    id: "finance.attempts",
    label: "Online checkouts",
    kind: "page",
    parent: "finance.selling",
    domain: "manage",
    route: "/admin/payments/attempts",
    capability: "payments.view",
    order: 3,
    description: "Every SSLCommerz / EPS checkout — paid, failed or abandoned.",
    keywords: ["online attempts", "payment session", "failed payment", "sslcommerz", "eps", "paid but no order", "gateway"],
  },
  {
    id: "finance.overview",
    label: "Gateway monitor",
    kind: "page",
    parent: "finance.selling",
    domain: "manage",
    route: "/admin/payments/overview",
    capability: "payments.view",
    order: 4,
    description: "Today's gateway success rate, failures and refund risk.",
    keywords: ["payments overview", "success rate", "eps reconciliation", "refund risk"],
  },
  {
    id: "finance.sales",
    label: "Sales",
    title: "Sales accounting",
    kind: "page",
    parent: "books.statements",
    domain: "manage",
    route: "/admin/finance/sales",
    capability: "finance.view",
    order: 1,
    description: "How each order was recorded in the books (sales, cost of goods, payments).",
    keywords: ["revenue", "cogs", "journal", "accounting events", "sync"],
  },

  // Purchasing
  {
    id: "finance.suppliers",
    label: "Suppliers",
    kind: "page",
    parent: "inventory",
    domain: "stock",
    route: "/admin/finance/suppliers",
    capability: "suppliers.view",
    order: 2,
    description: "The people and factories you buy from.",
    keywords: ["vendor", "purchasing", "payables", "supplier"],
  },
  {
    id: "finance.purchase-orders",
    label: "Purchase orders",
    kind: "page",
    parent: "inventory.more",
    domain: "stock",
    route: "/admin/finance/purchase-orders",
    capability: "purchasing.view",
    order: 0,
    description: "What you ordered from a supplier, before it arrives.",
    keywords: ["po", "buy", "order stock", "procurement"],
  },
  { id: "finance.purchase-order-detail", label: "Purchase order", kind: "detail", parent: "inventory.more", domain: "stock", route: "/admin/finance/purchase-orders/[id]", capability: "purchasing.view", order: 1, visibility: "hidden" },
  {
    id: "finance.goods-receipts",
    label: "Goods receipts",
    kind: "page",
    parent: "inventory.more",
    domain: "stock",
    route: "/admin/finance/goods-receipts",
    capability: "purchasing.view",
    order: 1,
    description: "Stock that actually arrived — receiving it adds it to inventory.",
    keywords: ["grn", "receive", "delivery", "restock"],
  },
  {
    id: "finance.supplier-invoices",
    label: "Supplier bills",
    kind: "page",
    parent: "finance.bills",
    domain: "manage",
    route: "/admin/finance/supplier-invoices",
    capability: "ap.view",
    order: 0,
    description: "Bills and credit notes suppliers send you.",
    keywords: ["supplier invoice", "bill", "credit note", "accounts payable", "ap"],
  },
  {
    id: "finance.payables",
    label: "Supplier dues",
    kind: "page",
    parent: "finance.bills",
    domain: "manage",
    route: "/admin/finance/payables",
    capability: "ap.view",
    order: 1,
    description: "How much you owe each supplier, what's overdue, and paying them.",
    keywords: ["payables", "accounts payable", "ageing", "aging", "owed to suppliers", "creditors", "pay supplier", "supplier payment", "supplier statement"],
  },
  { id: "finance.supplier-account", label: "Supplier account", kind: "detail", parent: "finance.bills", domain: "manage", route: "/admin/finance/payables/[supplierId]", capability: "ap.view", order: 4, visibility: "hidden" },
  {
    id: "finance.supplier-returns",
    label: "Supplier returns",
    kind: "page",
    parent: "inventory.more",
    domain: "stock",
    route: "/admin/finance/supplier-returns",
    capability: "purchasing.view",
    order: 2,
    description: "Stock you sent back to a supplier.",
    keywords: ["return to vendor", "rtv", "send back"],
  },
  {
    id: "finance.landed-costs",
    label: "Landed costs",
    kind: "page",
    parent: "inventory.more",
    domain: "stock",
    route: "/admin/finance/landed-costs",
    capability: "finance.view",
    order: 3,
    description: "Transport, labour or customs added to the goods they brought — the true cost per piece.",
    keywords: ["transport", "van", "carriage", "customs", "freight", "per piece cost", "landed cost"],
  },
  {
    id: "finance.packaging",
    label: "Packaging",
    kind: "page",
    parent: "inventory.more",
    domain: "stock",
    route: "/admin/finance/packaging",
    capability: "finance.view",
    order: 4,
    description: "What each parcel uses (poly, box, sticker), taken from stock automatically, and when it runs out.",
    keywords: ["poly", "box", "sticker", "packet", "packing", "run out", "consumables"],
  },
  {
    id: "finance.reports",
    label: "Purchasing reports",
    kind: "page",
    parent: "analytics",
    domain: "manage",
    route: "/admin/finance/reports",
    capability: "purchasing.view",
    order: 1,
    description: "Purchase register, stock value, price changes and supplier payments as CSV.",
    keywords: ["report", "purchase register", "grni", "price variance", "inventory valuation", "stock value", "cost adjustments", "supplier payments", "csv"],
  },

  // ── Books: the monthly routine and the accounting record ──────────────────────────────────────────────────────────
  {
    id: "books",
    label: "Books",
    kind: "module",
    domain: "manage",
    index: "/admin/finance/month-end",
    icon: "books",
    order: 85,
    goKey: "b",
    keywords: ["books", "accounting", "month end", "statements", "ledger", "journals", "partners", "payroll"],
  },
  // Blueprint P1.6: the monthly close is a page of its own (it was a tab of Needs attention)
  {
    id: "books.month-end",
    label: "Month-end",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/month-end",
    capability: "finance.view",
    order: -1,
    description: "Each step a month needs before its figures are Final, then closing it.",
    keywords: ["month end", "close the month", "checklist", "period close", "final", "draft"],
  },
  { id: "books.statements", label: "Statements", kind: "page", parent: "books", domain: "manage", index: "/admin/finance/statements", order: 3, innerList: true, description: "Profit & loss, balance sheet and cash flow, and how each order was recorded.", keywords: ["statements", "p&l", "sales accounting"] },
  { id: "books.ledger", label: "Ledger & journals", kind: "page", parent: "books", domain: "manage", index: "/admin/finance/ledger", order: 4, innerList: true, description: "Every account and every entry in the books.", keywords: ["ledger", "journals"] },

  // Reports & books
  {
    id: "finance.center",
    label: "Records & allocations",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/center",
    capability: "finance.view",
    order: 8,
    description: "What you have put in, figures still to confirm, costs to split, renewals and the SMS balance.",
    keywords: ["investment", "invested", "owner", "estimate", "verify", "missing data", "allocate", "split cost", "vehicle", "renewal", "domain", "vps", "sms balance", "usd rate"],
  },
  {
    id: "finance.stock-check",
    label: "Stock check",
    kind: "page",
    parent: "inventory.more",
    domain: "stock",
    route: "/admin/finance/stock-check",
    capability: "finance.view",
    order: 5,
    description: "Where every piece went — sold, on the way, in stock — what the materials must have been, and your counts beside the site.",
    keywords: ["stock", "reconcile", "count", "physical count", "tupi", "cap", "attar", "ml", "bottle", "box", "bubble poly", "roll", "how many bought", "direct steadfast"],
  },
  {
    id: "finance.profit",
    label: "By order & product",
    title: "Profit", kind: "page",
    parent: "reports.profit",
    domain: "manage",
    route: "/admin/finance/profit",
    capability: "finance.view",
    order: 0,
    description: "Daily profit, sales and ad spend for any period, with a chart — and what each order and product earned.",
    keywords: ["profit", "daily profit", "today", "margin", "ad spend", "roas", "chart", "contribution", "per order", "per product", "launch", "loss", "lav", "labh"],
  },
  // Profit month by month since the books started, with what is left to settle per month (docs/FINANCE_PROFIT_DASHBOARD.md §5).
  {
    id: "finance.monthly",
    label: "Month by month",
    kind: "page",
    parent: "reports.profit",
    domain: "manage",
    route: "/admin/finance/monthly",
    capability: "finance.view",
    order: 1,
    description: "Every month since the books started: sales, costs and profit, and what is still to settle before closing it.",
    keywords: ["monthly", "month", "profit by month", "p&l", "since the start", "close month", "mash", "labh"],
  },
  // Cost & profit planning (docs/COST_SHEET.md): what one sale of each size costs and earns, and the shop / category defaults.
  {
    id: "finance.product-costs",
    label: "Product costs & price planner",
    title: "Product costs", kind: "page",
    parent: "analytics",
    domain: "manage",
    route: "/admin/finance/product-costs",
    capability: "costing.view",
    order: -2,
    description: "What one sale of each product and size costs — making and selling — the profit left, and the price for your target.",
    keywords: ["cost", "cost sheet", "unit cost", "margin", "price", "pricing", "making cost", "recipe cost", "delivery cost", "suggested price", "target margin", "khoroch", "dam"],
  },
  {
    id: "finance.statements",
    label: "Financial statements",
    kind: "page",
    parent: "books.statements",
    domain: "manage",
    route: "/admin/finance/statements",
    capability: "finance.view",
    order: 0,
    description: "Profit & loss, balance sheet and cash flow for any period.",
    keywords: ["profit and loss", "p&l", "income statement", "balance sheet", "cash flow", "trial balance"],
  },
  {
    id: "finance.budgets",
    label: "Budgets & cash forecast",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/budgets",
    capability: "finance.view",
    order: 6,
    description: "Plan vs actual, and how much cash you'll have in the coming weeks.",
    keywords: ["budget", "forecast", "cash flow forecast", "runway", "plan", "variance", "burn"],
  },
  {
    id: "finance.fixed-assets",
    label: "Fixed assets",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/fixed-assets",
    capability: "finance.view",
    order: 5,
    description: "Machines, furniture and vehicles you own, and their depreciation.",
    keywords: ["asset register", "depreciation", "equipment", "machine", "vehicle", "disposal", "book value"],
  },
  {
    id: "finance.ledger",
    label: "Ledger",
    kind: "page",
    parent: "books.ledger",
    domain: "manage",
    route: "/admin/finance/ledger",
    capability: "finance.view",
    order: 0,
    description: "Every accounting account and its balance (for your accountant).",
    keywords: ["chart of accounts", "general ledger", "account balance"],
  },
  {
    id: "finance.journals",
    label: "Journals",
    kind: "page",
    parent: "books.ledger",
    domain: "manage",
    route: "/admin/finance/journals",
    capability: "finance.view",
    order: 1,
    description: "Every entry in the books; add or correct a manual entry.",
    keywords: ["journal entry", "manual journal", "reverse", "double entry"],
  },

  // Payroll & partners
  {
    id: "finance.payroll",
    label: "Payroll",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/payroll",
    capability: "finance.sensitive",
    order: 2,
    description: "Employees, monthly salary runs and printable payslips.",
    keywords: ["salary", "salaries", "wages", "payslip", "employees", "staff", "provident fund", "pf", "bonus", "tax withheld"],
  },
  {
    id: "finance.equity",
    label: "Owner & partners",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/equity",
    capability: "finance.sensitive",
    order: 1,
    description: "What the owner put in and took out, and each partner's monthly profit share — earned, paid and owed.",
    keywords: ["partner", "capital", "owner", "drawings", "equity", "investment", "invest", "withdraw", "share", "profit share", "20%", "pay partner", "current account"],
  },

  // Settings › Books setup: done once, then rarely (tab 2 §2)
  { id: "settings.books", label: "Books setup", kind: "settings", parent: "settings", domain: "system", index: "/admin/finance/opening", capability: "finance.view", order: 4, innerList: true, description: "Start the books, opening stock value, account mapping, rates, tax codes and checks.", keywords: ["books setup", "opening", "mapping", "rates"] },
  { id: "settings.team-security", label: "Team & security", kind: "settings", parent: "settings", domain: "system", index: "/admin/team", order: 5, keywords: ["team", "audit"] },
  { id: "settings.system", label: "System", kind: "settings", parent: "settings", domain: "system", index: "/admin/system-health", order: 6, keywords: ["storage", "health"] },

  // Setup & checks
  {
    id: "finance.rates",
    label: "Courier & gateway rates",
    kind: "page",
    parent: "settings.books",
    domain: "system",
    route: "/admin/finance/rates",
    capability: "finance.view",
    order: 3,
    description: "Steadfast's charges by area and EPS fees — so every order's cost shows the day it happens.",
    keywords: ["steadfast charge", "delivery charge", "cod charge", "return charge", "eps fee", "rate card"],
  },
  {
    id: "finance.opening",
    label: "Start the books",
    kind: "page",
    parent: "settings.books",
    domain: "system",
    route: "/admin/finance/opening",
    capability: "finance.view",
    order: 0,
    description: "Pick the date your books start and enter what you had and owed on that day.",
    keywords: ["opening balances", "opening date", "financial opening date", "fiscal year", "go live", "start", "setup"],
  },
  {
    id: "finance.checks",
    label: "Books health check",
    kind: "page",
    parent: "settings.books",
    domain: "system",
    route: "/admin/finance/checks",
    capability: "finance.view",
    order: 5,
    description: "Automatic checks that the books match orders, stock and money accounts.",
    keywords: ["finance checks", "reconciliation", "revenue check", "cogs check"],
  },
  {
    id: "finance.exceptions",
    label: "Missing costs & exceptions",
    kind: "page",
    parent: "books",
    domain: "manage",
    route: "/admin/finance/exceptions",
    capability: "finance.view",
    order: 7,
    description: "Products sold without a cost, and other records the books couldn't post.",
    keywords: ["finance exceptions", "missing cost", "estimate", "unmatched"],
  },
  {
    id: "finance.inventory-cutover",
    label: "Opening stock value",
    kind: "page",
    parent: "settings.books",
    domain: "system",
    route: "/admin/finance/inventory-cutover",
    capability: "costing.view",
    order: 1,
    description: "One-time step: value the stock you already had so profit is calculated correctly.",
    keywords: ["valuation cutover", "inventory valuation", "costing", "average cost", "opening stock value"],
  },
  {
    id: "finance.tax-codes",
    label: "Purchase tax codes",
    kind: "page",
    parent: "settings.books",
    domain: "system",
    route: "/admin/finance/tax-codes",
    capability: "purchasing.view",
    order: 4,
    description: "VAT / input-tax rates used on supplier bills.",
    keywords: ["vat", "input tax", "tax rate"],
  },
  {
    id: "finance.mappings",
    label: "Account mapping",
    kind: "page",
    parent: "settings.books",
    domain: "system",
    route: "/admin/finance/mappings",
    capability: "finance.view",
    order: 2,
    description: "Which account in the books each kind of sale, cost or payment is recorded to.",
    keywords: ["mapping", "posting accounts", "chart of accounts", "default accounts"],
  },
  {
    id: "finance.activity",
    label: "Activity log",
    kind: "page",
    parent: "settings.books",
    domain: "system",
    route: "/admin/finance/activity",
    capability: "finance.view",
    order: 6,
    description: "Every change made in Finance and who made it, plus accounting events that failed to post.",
    keywords: ["audit", "history", "events", "failed events", "retry", "who changed"],
  },

  {
    id: "analytics",
    label: "Reports",
    kind: "module",
    domain: "manage",
    index: "/admin/finance/profit",
    activeFor: ["/admin/analytics", "/admin/bi", "/admin/ai-assistant"],
    icon: "reports",
    order: 90,
    goKey: "a",
    keywords: ["business intelligence", "bi", "reports"],
  },
  { id: "reports.profit", label: "Profit", kind: "page", parent: "analytics", domain: "manage", index: "/admin/finance/profit", order: -3, innerList: true, description: "Book profit by order and product, and month by month.", keywords: ["profit", "month by month"] },
  { id: "reports.analytics", label: "Store analytics", kind: "page", parent: "analytics", domain: "manage", index: "/admin/analytics/overview", order: 0, description: "Sales, products, customers, marketing and operations — sales estimates, not book profit.", keywords: ["analytics", "bi", "sales estimate"] },
  ...ANALYTICS_TABS.map(
    ([slug, label, keywords, deprecatedRoutes], i): NavNode => ({
      id: `analytics.${slug}`,
      label,
      kind: "report",
      parent: "reports.analytics",
      domain: "manage",
      route: `/admin/analytics/${slug}`,
      capability: "analytics.view",
      order: i,
      keywords,
      deprecatedRoutes,
    }),
  ),
  {
    id: "analytics.ai-assistant",
    label: "AI assistant",
    kind: "page",
    parent: "analytics",
    domain: "manage",
    route: "/admin/ai-assistant",
    featureFlag: "ai-assistant",
    order: 2,
    keywords: ["ai", "chat"],
  },

  // ── System (sidebar footer) ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "settings",
    label: term("settings"),
    kind: "module",
    domain: "system",
    index: "/admin/settings",
    activeFor: ["/admin/settings", "/admin/payment-methods", "/admin/sms-notifications", "/admin/team", "/admin/audit-log", "/admin/storage", "/admin/system-health"],
    icon: "settings",
    order: 100,
    goKey: "s",
    keywords: ["store", "branding"],
  },
  { id: "settings.store", label: "Store & branding", title: term("settings"), kind: "settings", parent: "settings", domain: "system", route: "/admin/settings", order: 0, keywords: ["logo", "store info"] },
  { id: "settings.payment-methods", label: "Payment methods", kind: "settings", parent: "settings", domain: "system", route: "/admin/payment-methods", order: 1, keywords: ["checkout", "logos"] },
  {
    id: "settings.delivery-zones",
    label: "Delivery zones",
    kind: "settings",
    parent: "settings",
    domain: "system",
    route: "/admin/settings/delivery-zones",
    capability: "settings.manage",
    order: 2,
    keywords: ["shipping fee", "delivery charge", "free delivery", "zones"],
  },
  {
    id: "settings.sms",
    label: "SMS notifications",
    kind: "settings",
    parent: "settings",
    domain: "system",
    route: "/admin/sms-notifications",
    capability: "settings.manage",
    order: 3,
    keywords: ["sms templates"],
  },

  { id: "administration.team", label: term("teamMember"), kind: "settings", parent: "settings.team-security", domain: "system", route: "/admin/team", capability: "team.manage", order: 0, keywords: ["staff", "admins"] },
  { id: "administration.audit-log", label: "Audit log", kind: "settings", parent: "settings.team-security", domain: "system", route: "/admin/audit-log", capability: "audit.view", order: 1, keywords: ["history"] },
  { id: "administration.storage", label: "Storage", kind: "settings", parent: "settings.system", domain: "system", route: "/admin/storage", capability: "settings.manage", order: 1, keywords: ["uploads", "media", "trash"] },
  {
    id: "administration.system-health",
    label: "System health",
    kind: "settings",
    parent: "settings.system",
    domain: "system",
    route: "/admin/system-health",
    capability: "ops.view",
    order: 0,
    keywords: ["health", "status", "reliability", "background jobs", "drift", "outbox"],
  },
];

// ── Derivation ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const byId = new Map(NAV_NODES.map((n) => [n.id, n]));

export function navNode(id: string): NavNode | undefined {
  return byId.get(id);
}

export function childrenOf(id: string): NavNode[] {
  return NAV_NODES.filter((n) => n.parent === id).sort((a, b) => a.order - b.order);
}

/** Root-first ancestry, ending with the node itself. */
export function ancestryOf(node: NavNode): NavNode[] {
  const chain: NavNode[] = [];
  for (let n: NavNode | undefined = node; n; n = n.parent ? byId.get(n.parent) : undefined) chain.unshift(n);
  return chain;
}

export function moduleOf(node: NavNode): NavNode {
  return ancestryOf(node)[0]!;
}

export const isDynamicRoute = (route: string) => route.includes("[");

function routePattern(route: string): RegExp {
  const escaped = route
    .split("/")
    .map((segment) => (/^\[.+\]$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${escaped}/?$`);
}

/** Does `pathname` match the route pattern exactly (dynamic segments match any single segment)? */
export function matchesRoute(route: string, pathname: string): boolean {
  return routePattern(route).test(pathname);
}

const underPrefix = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * The node a pathname belongs to: an exact route match (the deepest one, so a page beats its grouping node), else the
 * node whose own route or `activeFor` prefix is the longest one containing the pathname. Undefined outside the manifest.
 */
export function resolveNavNode(pathname: string): NavNode | undefined {
  const exact = NAV_NODES.filter((n) => n.route && matchesRoute(n.route, pathname));
  if (exact.length) return exact.sort((a, b) => ancestryOf(b).length - ancestryOf(a).length)[0];
  let best: { node: NavNode; length: number } | undefined;
  for (const node of NAV_NODES) {
    const prefixes = [...(node.route && !isDynamicRoute(node.route) ? [node.route] : []), ...(node.activeFor ?? [])];
    for (const prefix of prefixes) {
      if (underPrefix(prefix, pathname) && (!best || prefix.length > best.length || (prefix.length === best.length && ancestryOf(node).length > ancestryOf(best.node).length))) {
        best = { node, length: prefix.length };
      }
    }
  }
  return best?.node;
}

/** Where clicking a node goes: its own static route, else its declared index. */
export function hrefOf(node: NavNode): string | undefined {
  return node.index ?? (node.route && !isDynamicRoute(node.route) ? node.route : undefined);
}

export interface NavAccess {
  can: (capability: Capability) => boolean;
  flagEnabled: (flag: FeatureFlag) => boolean;
  /** What the store's data says it does; absent = not known yet, so a node that needs one stays hidden. */
  storeHas?: (capability: StoreCapability) => boolean;
}

/** Visible to this admin on this installation (its own capability, flag and store capability — not its parents'). */
export function isNodeAllowed(node: NavNode, access: NavAccess): boolean {
  if (node.capability && !access.can(node.capability)) return false;
  if (node.featureFlag && !access.flagEnabled(node.featureFlag)) return false;
  if (node.storeCapability && !access.storeHas?.(node.storeCapability)) return false;
  return true;
}

const listed = (node: NavNode) => node.visibility !== "hidden";

export interface NavItem {
  node: NavNode;
  href: string;
  children: NavItem[];
}

/**
 * A node's listed pages this admin may open. A grouping page without a route of its own (Money › Payments & refunds)
 * carries no capability: it shows when at least one of its pages does (blueprint P0.6 — a finance-only role reaches its
 * pages without being granted anything new), and opens its declared index only when that page is visible, else its first.
 */
function visibleChildren(id: string, access: NavAccess): NavItem[] {
  return childrenOf(id)
    .filter((c) => listed(c) && isNodeAllowed(c, access))
    .flatMap((c) => {
      const children = visibleChildren(c.id, access);
      if (!c.route && children.length === 0) return [];
      const declared = hrefOf(c);
      const reachable = !c.index || c.route === c.index || flatten(children).some((x) => x.href === c.index);
      const href = reachable ? declared : children[0]?.href;
      return href ? [{ node: c, href, children }] : [];
    });
}

/** A node's listed pages this admin may open (with their own pages) — the Finance overview's map of every page. */
export function navChildren(id: string, access: NavAccess): NavItem[] {
  return visibleChildren(id, access);
}

/**
 * The sidebar tree for this admin: modules grouped by domain, each with its visible pages. A grouping module whose pages
 * are all hidden disappears, and one whose declared index is hidden opens its first visible page instead.
 */
export function navTree(access: NavAccess): Array<{ domain: NavDomain; label: string | null; modules: NavItem[] }> {
  return NAV_DOMAINS.map(({ id, label }) => ({
    domain: id,
    label,
    modules: NAV_NODES.filter((n) => n.kind === "module" && n.domain === id && isNodeAllowed(n, access))
      .sort((a, b) => a.order - b.order)
      .flatMap((module): NavItem[] => {
        const children = visibleChildren(module.id, access);
        if (!module.route && children.length === 0) return [];
        const declared = hrefOf(module);
        const reachable = !module.index || flatten(children).some((c) => c.href === module.index || c.node.route === module.index);
        const href = reachable ? declared : children[0]?.href;
        return href ? [{ node: module, href, children }] : [];
      }),
  })).filter((group) => group.modules.length > 0);
}

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((i) => [i, ...flatten(i.children)]);
}

/**
 * In-page section tabs for a pathname: a grouping page's own pages (Catalog setup → its ten setup pages), otherwise the
 * pages beside it (an Orders page → All orders / Return requests). Empty when there is nothing to switch between.
 */
export function sectionTabsFor(pathname: string, access: NavAccess): NavItem[] {
  const node = resolveNavNode(pathname);
  if (!node) return [];
  const own = visibleChildren(node.id, access);
  if (own.length > 1) return own;
  const siblings = node.parent ? visibleChildren(node.parent, access) : [];
  return siblings.length > 1 ? siblings : [];
}

/**
 * The shell's section bar for a pathname: the current module's pages (the same list the sidebar shows under it) and the
 * one that holds the current page. Null when the module has nothing to switch between, or on a page outside that list —
 * a create flow or a detail view (New order, an order, the product builder) gets its focus, not the module's tabs.
 */
export function sectionBarFor(pathname: string, access: NavAccess): { module: NavNode; tabs: NavItem[]; activeHref: string } | null {
  const node = resolveNavNode(pathname);
  if (!node) return null;
  const moduleId = moduleOf(node).id;
  const item = navTree(access)
    .flatMap((g) => g.modules)
    .find((m) => m.node.id === moduleId);
  if (!item || item.children.length < 2) return null;
  const trail = new Set(ancestryOf(node).map((n) => n.id));
  const active = item.children.find((c) => trail.has(c.node.id));
  return active ? { module: item.node, tabs: item.children, activeHref: active.href } : null;
}

export interface Breadcrumb {
  label: string;
  href?: string;
}

/** Root-first breadcrumbs for a pathname (empty outside the manifest). The last crumb has no href. */
export function breadcrumbsFor(pathname: string): Breadcrumb[] {
  const node = resolveNavNode(pathname);
  if (!node) return [];
  const chain = ancestryOf(node);
  // A module's own landing page reads as just the module ("Orders", not "Orders › All orders").
  const trimmed = chain.length > 1 && chain.at(-1)!.route && moduleOf(node).index === chain.at(-1)!.route ? chain.slice(0, -1) : chain;
  return trimmed.map((n, i) => ({ label: n.breadcrumb ?? n.label, href: i < trimmed.length - 1 ? hrefOf(n) : undefined }));
}

export const ADMIN_TITLE_SUFFIX = "Store Console";

/** The page title for a pathname: the node's `title`, else its label. */
export function pageTitleFor(pathname: string): string | undefined {
  const node = resolveNavNode(pathname);
  return node ? (node.title ?? node.label) : undefined;
}

export function documentTitleFor(pathname: string): string {
  const title = pageTitleFor(pathname);
  return title ? `${title} · ${ADMIN_TITLE_SUFFIX}` : ADMIN_TITLE_SUFFIX;
}

/** Every create command this admin may run, in module order — the Create menu and the palette's Create group. */
export function createCommands(access: NavAccess): Array<NavCommand & { node: NavNode }> {
  return NAV_NODES.filter((n) => n.commands?.length && isNodeAllowed(n, access))
    .sort((a, b) => a.order - b.order)
    .flatMap((n) => n.commands!.filter((c) => c.kind === "create" && (!c.capability || access.can(c.capability))).map((c) => ({ ...c, node: n })));
}

export type PaletteGroup = "Pages" | "Reports" | "Settings";

/** Palette page results: listed nodes exactly as the sidebar shows them to this admin — a grouping page or module with
 * no visible pages is absent, and one whose index is hidden lands on its first visible page (never a page it can't open). */
export function searchableNodes(access: NavAccess): Array<{ node: NavNode; href: string; group: PaletteGroup }> {
  const visible = new Map(
    navTree(access)
      .flatMap((g) => g.modules)
      .flatMap((m) => [m, ...flatten(m.children)])
      .map((i) => [i.node.id, i.href] as const),
  );
  return NAV_NODES.filter((n) => n.search !== false && listed(n) && n.kind !== "detail" && n.kind !== "create" && visible.has(n.id)).flatMap((n) => {
    const href = visible.get(n.id)!;
    // Skip a page its parent already lands on (the parent's entry covers it — "Orders", not also "All orders").
    if (n.parent && visible.get(n.parent) === href) return [];
    const group: PaletteGroup = n.kind === "report" ? "Reports" : n.kind === "settings" ? "Settings" : "Pages";
    return [{ node: n, href, group }];
  });
}

/** `g` chord targets: module go-keys this admin can reach. */
export function goTargets(access: NavAccess): Array<{ key: string; node: NavNode; href: string }> {
  return navTree(access)
    .flatMap((g) => g.modules)
    .filter((m) => m.node.goKey)
    .map((m) => ({ key: m.node.goKey!, node: m.node, href: m.href }));
}

/** The current location of a deprecated route (query string kept), or null when the pathname isn't deprecated. */
/**
 * Page width (Admin V2): the console uses the full screen — lists, tables, reports and dashboards get every pixel, like
 * an ERP. Pages that are mostly a form or a short list of settings read better in one centered column, so they are named
 * here (exact routes) instead of each page capping itself.
 */
export const FORM_WIDTH_ROUTES: readonly string[] = [
  "/admin/settings",
  "/admin/settings/delivery-zones",
  "/admin/payment-methods",
  "/admin/sms-notifications",
  "/admin/team",
  "/admin/system-health",
  "/admin/products/import",
  "/admin/catalog/sku",
  "/admin/catalog/sections",
  "/admin/catalog/spec-groups",
];

export function pageWidthFor(pathname: string): "form" | "full" {
  return FORM_WIDTH_ROUTES.includes(pathname.replace(/\/+$/, "") || "/") ? "form" : "full";
}

export function deprecatedRedirect(pathname: string, search = ""): string | null {
  for (const node of NAV_NODES) {
    for (const entry of node.deprecatedRoutes ?? []) {
      // An entry may name the view it now lives in ("/admin/bi/financial?view=financial"); the visitor's own query wins.
      const [old = entry, extra] = entry.split("?");
      const match = routePattern(old).exec(pathname);
      if (!match || !node.route) continue;
      const oldSegments = old.split("/");
      const values = new Map<string, string>();
      pathname.split("/").forEach((segment, i) => {
        const name = oldSegments[i];
        if (name && /^\[.+\]$/.test(name)) values.set(name, segment);
      });
      const target = node.route
        .split("/")
        .map((segment) => values.get(segment) ?? segment)
        .join("/");
      if (!extra) return `${target}${search}`;
      const query = new URLSearchParams(search);
      for (const [key, value] of new URLSearchParams(extra)) if (!query.has(key)) query.set(key, value);
      return `${target}?${query.toString()}`;
    }
  }
  return null;
}
