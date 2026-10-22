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
export type NavDomain = "home" | "operate" | "grow" | "manage" | "system";
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
  | "administration";
/** Work-queue counts a node may show — resolved by the shell from the dashboard's attention counts. */
export type NavBadgeSource = "orders" | "messages" | "finance";

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

export const NAV_DOMAINS: ReadonlyArray<{ id: NavDomain; label: string | null }> = [
  { id: "home", label: null },
  { id: "operate", label: "Operate" },
  { id: "grow", label: "Grow" },
  { id: "manage", label: "Manage" },
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
  ["materials", "Materials", ["fabric"]],
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
  {
    id: "orders.returns",
    label: term("returnRequest"),
    kind: "page",
    parent: "orders",
    domain: "operate",
    route: "/admin/return-requests",
    capability: "orders.view",
    order: 1,
    keywords: ["exchange", "refund", "returns"],
  },
  { id: "orders.new", label: "New order", kind: "create", parent: "orders", domain: "operate", route: "/admin/orders/new", capability: "orders.manage", order: 2, visibility: "hidden" },
  { id: "orders.print-labels", label: "Print labels", kind: "page", parent: "orders", domain: "operate", route: "/admin/orders/print-labels", capability: "orders.view", order: 3, visibility: "hidden" },
  { id: "orders.detail", label: term("order", 1), kind: "detail", parent: "orders", domain: "operate", route: "/admin/orders/[id]", capability: "orders.view", order: 4, visibility: "hidden" },

  {
    id: "products",
    label: term("product"),
    kind: "module",
    domain: "operate",
    index: "/admin/products",
    activeFor: ["/admin/products", "/admin/categories", "/admin/attributes", "/admin/catalog"],
    icon: "products",
    capability: "catalog.view",
    order: 20,
    mobile: "primary",
    goKey: "p",
    keywords: ["catalog"],
    commands: [{ id: "create.product", kind: "create", label: "New product", hint: "Product Builder", route: PRODUCT_NEW_HREF, capability: "catalog.manage" }],
  },
  { id: "products.all", label: "All products", title: term("product"), kind: "page", parent: "products", domain: "operate", route: "/admin/products", capability: "catalog.view", order: 0 },
  { id: "products.categories", label: term("category"), kind: "page", parent: "products", domain: "operate", route: "/admin/categories", capability: "catalog.view", order: 1 },
  {
    id: "products.variant-options",
    label: term("variantOption"),
    kind: "page",
    parent: "products",
    domain: "operate",
    route: "/admin/attributes",
    capability: "catalog.view",
    order: 2,
    keywords: ["size", "colour", "color", "attributes"],
  },
  { id: "products.import", label: "Import / export", kind: "page", parent: "products", domain: "operate", route: "/admin/products/import", capability: "catalog.view", order: 3, keywords: ["csv"] },
  {
    id: "products.catalog-setup",
    label: term("catalogSetup"),
    kind: "settings",
    parent: "products",
    domain: "operate",
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
      domain: "operate",
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
    domain: "operate",
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
    domain: "operate",
    route: "/admin/products/[id]/edit",
    capability: "catalog.view",
    order: 6,
    visibility: "hidden",
    deprecatedRoutes: ["/admin/products/wizard/[id]/edit"],
  },

  // Inventory groups stock with production (docs/MANUFACTURING.md): materials, bills of materials and production orders
  // are the stock that is made rather than bought — kept within the 12 primary modules.
  { id: "inventory", label: term("inventory"), kind: "module", index: "/admin/inventory", activeFor: ["/admin/manufacturing"], domain: "operate", icon: "inventory", capability: "inventory.view", order: 30, mobile: "primary", goKey: "i", keywords: ["stock", "production", "manufacturing"] },
  { id: "inventory.stock", label: "Stock", kind: "page", parent: "inventory", domain: "operate", route: "/admin/inventory", capability: "inventory.view", order: 0, keywords: ["stock", "adjust", "movements"] },
  { id: "inventory.production", label: "Production", kind: "page", parent: "inventory", domain: "operate", route: "/admin/manufacturing", capability: "manufacturing.view", order: 1, keywords: ["manufacturing", "wip", "work in progress", "producer performance", "yield"] },
  { id: "inventory.production-orders", label: "Production orders", kind: "page", parent: "inventory", domain: "operate", route: "/admin/manufacturing/production-orders", capability: "manufacturing.view", order: 2, keywords: ["manufacturing", "factory", "mo", "make", "produce"] },
  { id: "inventory.production-order-detail", label: "Production order", kind: "detail", parent: "inventory", domain: "operate", route: "/admin/manufacturing/production-orders/[id]", capability: "manufacturing.view", order: 3, visibility: "hidden" },
  { id: "inventory.boms", label: "Bills of materials", kind: "page", parent: "inventory", domain: "operate", route: "/admin/manufacturing/boms", capability: "manufacturing.view", order: 4, keywords: ["bom", "recipe", "materials per unit"] },
  { id: "inventory.materials", label: "Materials", kind: "page", parent: "inventory", domain: "operate", route: "/admin/manufacturing/materials", capability: "manufacturing.view", order: 5, keywords: ["raw materials", "fabric", "trims", "packaging"] },

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
    label: term("message"),
    kind: "module",
    domain: "operate",
    index: "/admin/feedback",
    activeFor: ["/admin/feedback", "/admin/saved-answers", "/admin/reviews"],
    icon: "messages",
    capability: "content.manage",
    badge: "messages",
    order: 50,
    goKey: "e",
    keywords: ["support", "feedback"],
  },
  { id: "messages.feedback", label: "Inbox", kind: "page", parent: "messages", domain: "operate", route: "/admin/feedback", capability: "content.manage", order: 0, keywords: ["support", "messages", "feedback", "contact form", "reply"] },
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
  { id: "messages.reviews", label: term("review"), kind: "page", parent: "messages", domain: "operate", route: "/admin/reviews", capability: "content.manage", order: 2 },

  // ── Grow ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "marketing",
    label: term("marketing"),
    kind: "module",
    domain: "grow",
    index: "/admin/flash-sales",
    activeFor: ["/admin/flash-sales", "/admin/coupons", "/admin/bundles", "/admin/campaigns"],
    icon: "marketing",
    capability: "promotions.manage",
    order: 60,
    goKey: "m",
    keywords: ["promotions", "discount"],
    commands: [
      { id: "create.coupon", kind: "create", label: "New coupon", hint: term("marketing"), route: "/admin/coupons", capability: "promotions.manage" },
      { id: "create.flash-sale", kind: "create", label: "New flash sale", hint: term("marketing"), route: "/admin/flash-sales", capability: "promotions.manage" },
    ],
  },
  { id: "marketing.flash-sales", label: term("flashSale"), kind: "page", parent: "marketing", domain: "grow", route: "/admin/flash-sales", capability: "promotions.manage", order: 0 },
  { id: "marketing.coupons", label: term("coupon"), kind: "page", parent: "marketing", domain: "grow", route: "/admin/coupons", capability: "promotions.manage", order: 1, keywords: ["discount code"] },
  { id: "marketing.bundles", label: term("bundle"), kind: "page", parent: "marketing", domain: "grow", route: "/admin/bundles", capability: "promotions.manage", order: 2 },
  { id: "marketing.campaigns", label: term("campaign"), kind: "page", parent: "marketing", domain: "grow", route: "/admin/campaigns", capability: "promotions.manage", order: 3, keywords: ["sms"] },

  {
    id: "storefront",
    label: term("storefront"),
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
    label: term("finance"),
    kind: "module",
    domain: "manage",
    index: "/admin/finance",
    activeFor: ["/admin/payments", "/admin/finance"],
    icon: "finance",
    capability: "payments.view",
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
    title: term("finance"),
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance",
    capability: "payments.view",
    order: -2,
    keywords: ["finance home", "summary", "cash", "profit", "owed"],
  },
  {
    id: "finance.attention",
    label: "Needs attention",
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance/attention",
    capability: "finance.view",
    order: -1,
    description: "Problems in the books that need you, and the month-end close checklist.",
    keywords: ["alerts", "to do", "overdue", "month end", "close the month", "checklist", "period close"],
  },
  {
    id: "finance.my-cash",
    label: "My cash",
    kind: "page",
    parent: "finance",
    domain: "manage",
    route: "/admin/finance/my-cash",
    capability: "finance.custody",
    order: 0,
    description: "The cash you hold: hand it over, confirm what you received, count it and pay from it.",
    keywords: ["handover", "cash in hand", "manager cash", "cash count", "petty cash"],
  },
  {
    id: "finance.money",
    label: "Money",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/finance/accounts",
    capability: "finance.view",
    order: 10,
    innerList: true,
    description: "Your cash, bank and bKash/Nagad balances, and the money you spend or borrow.",
    keywords: ["cash", "bank", "bkash", "expenses", "loans"],
  },
  {
    id: "finance.selling",
    label: "Sales & payments",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/payments/transactions",
    capability: "payments.view",
    order: 11,
    innerList: true,
    description: "Money customers paid, refunds, and what couriers and gateways still owe you.",
    keywords: ["payments", "cod", "courier", "gateway", "refunds", "settlements"],
  },
  {
    id: "finance.purchasing",
    label: "Purchasing",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/finance/suppliers",
    capability: "suppliers.view",
    order: 12,
    innerList: true,
    description: "Buying stock: suppliers, purchase orders, deliveries, bills and what you owe them.",
    keywords: ["suppliers", "purchase orders", "bills", "payables"],
  },
  {
    id: "finance.books",
    label: "Reports & books",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/finance/statements",
    capability: "finance.view",
    order: 13,
    innerList: true,
    description: "Profit and loss, balance sheet, budgets and the full accounting record.",
    keywords: ["books", "accounts", "statements", "ledger", "journals", "profit", "balance sheet", "reports"],
  },
  {
    id: "finance.people",
    label: "Payroll & partners",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/finance/payroll",
    capability: "finance.sensitive",
    order: 14,
    innerList: true,
    description: "Staff salaries and payslips, and each partner's capital and drawings.",
    keywords: ["salary", "payroll", "partners", "equity"],
  },
  {
    id: "finance.setup",
    label: "Setup & checks",
    kind: "page",
    parent: "finance",
    domain: "manage",
    index: "/admin/finance/opening",
    capability: "finance.view",
    order: 15,
    innerList: true,
    description: "Start the books, one-time setup, and the checks that prove the books are right.",
    keywords: ["setup", "settings", "checks", "tax", "opening stock"],
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
    parent: "finance.money",
    domain: "manage",
    route: "/admin/finance/expenses",
    capability: "finance.view",
    order: 1,
    description: "Rent, bills, ads and other spending, plus fixed monthly costs.",
    keywords: ["expense", "rent", "salary", "subscription", "recurring", "fixed costs", "break-even"],
  },
  {
    id: "finance.loans",
    label: "Loans",
    kind: "page",
    parent: "finance.money",
    domain: "manage",
    route: "/admin/finance/loans",
    capability: "finance.view",
    order: 2,
    description: "Money you borrowed, instalments due and interest.",
    keywords: ["loan", "borrowing", "interest", "emi", "instalment", "repayment"],
  },
  {
    id: "finance.reconciliation",
    label: "Bank reconciliation",
    kind: "page",
    parent: "finance.money",
    domain: "manage",
    route: "/admin/finance/reconciliation",
    capability: "finance.view",
    order: 3,
    description: "Match your bank statement against the books line by line.",
    keywords: ["statement", "reconcile", "csv import"],
  },
  { id: "finance.reconciliation-detail", label: "Reconciliation", kind: "detail", parent: "finance.money", domain: "manage", route: "/admin/finance/reconciliation/[id]", capability: "finance.view", order: 3, visibility: "hidden" },
  {
    id: "finance.prepaid",
    label: "Prepaid costs",
    kind: "page",
    parent: "finance.money",
    domain: "manage",
    route: "/admin/finance/prepaid",
    capability: "finance.view",
    order: 4,
    description: "Hosting, domain, rent paid in advance — used up month by month, with renewal dates.",
    keywords: ["prepaid", "domain", "hosting", "server", "advance rent", "subscription", "renewal", "amortisation"],
  },
  {
    id: "finance.ads",
    label: "Ad spend",
    kind: "page",
    parent: "finance.money",
    domain: "manage",
    route: "/admin/finance/ads",
    capability: "finance.view",
    order: 5,
    description: "Every campaign's daily spend from Meta or its budget, the orders it brought and profit after ads.",
    keywords: ["facebook ads", "meta", "boost", "campaign", "budget", "roas", "marketing", "tiktok ads"],
  },

  // Sales & payments
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
    label: "Courier & gateway payouts",
    kind: "page",
    parent: "finance.selling",
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
    parent: "finance.selling",
    domain: "manage",
    route: "/admin/finance/courier",
    capability: "finance.view",
    order: 2.5,
    description: "What Steadfast owes you vs its own balance, payouts to import, parcels stuck or unpaid.",
    keywords: ["steadfast", "courier balance", "cod receivable", "payout import", "lost parcel", "partial delivery", "courier charges"],
  },
  {
    id: "finance.courier-costs",
    label: "Courier costs",
    kind: "page",
    parent: "finance.selling",
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
    label: "Sales accounting",
    kind: "page",
    parent: "finance.selling",
    domain: "manage",
    route: "/admin/finance/sales",
    capability: "finance.view",
    order: 5,
    description: "How each order was recorded in the books (sales, cost of goods, payments).",
    keywords: ["revenue", "cogs", "journal", "accounting events", "sync"],
  },

  // Purchasing
  {
    id: "finance.suppliers",
    label: "Suppliers",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/suppliers",
    capability: "suppliers.view",
    order: 0,
    description: "The people and factories you buy from.",
    keywords: ["vendor", "purchasing", "payables", "supplier"],
  },
  {
    id: "finance.purchase-orders",
    label: "Purchase orders",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/purchase-orders",
    capability: "purchasing.view",
    order: 1,
    description: "What you ordered from a supplier, before it arrives.",
    keywords: ["po", "buy", "order stock", "procurement"],
  },
  { id: "finance.purchase-order-detail", label: "Purchase order", kind: "detail", parent: "finance.purchasing", domain: "manage", route: "/admin/finance/purchase-orders/[id]", capability: "purchasing.view", order: 1, visibility: "hidden" },
  {
    id: "finance.goods-receipts",
    label: "Goods receipts",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/goods-receipts",
    capability: "purchasing.view",
    order: 2,
    description: "Stock that actually arrived — receiving it adds it to inventory.",
    keywords: ["grn", "receive", "delivery", "restock"],
  },
  {
    id: "finance.supplier-invoices",
    label: "Supplier bills",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/supplier-invoices",
    capability: "ap.view",
    order: 3,
    description: "Bills and credit notes suppliers send you.",
    keywords: ["supplier invoice", "bill", "credit note", "accounts payable", "ap"],
  },
  {
    id: "finance.payables",
    label: "Supplier dues",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/payables",
    capability: "ap.view",
    order: 4,
    description: "How much you owe each supplier, what's overdue, and paying them.",
    keywords: ["payables", "accounts payable", "ageing", "aging", "owed to suppliers", "creditors", "pay supplier", "supplier payment", "supplier statement"],
  },
  { id: "finance.supplier-account", label: "Supplier account", kind: "detail", parent: "finance.purchasing", domain: "manage", route: "/admin/finance/payables/[supplierId]", capability: "ap.view", order: 4, visibility: "hidden" },
  {
    id: "finance.supplier-returns",
    label: "Supplier returns",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/supplier-returns",
    capability: "purchasing.view",
    order: 5,
    description: "Stock you sent back to a supplier.",
    keywords: ["return to vendor", "rtv", "send back"],
  },
  {
    id: "finance.landed-costs",
    label: "Landed costs",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/landed-costs",
    capability: "finance.view",
    order: 5.5,
    description: "Transport, labour or customs added to the goods they brought — the true cost per piece.",
    keywords: ["transport", "van", "carriage", "customs", "freight", "per piece cost", "landed cost"],
  },
  {
    id: "finance.packaging",
    label: "Packaging",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/packaging",
    capability: "finance.view",
    order: 5.6,
    description: "What each parcel uses (poly, box, sticker), taken from stock automatically, and when it runs out.",
    keywords: ["poly", "box", "sticker", "packet", "packing", "run out", "consumables"],
  },
  {
    id: "finance.refills",
    label: "Quick refill",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/refills",
    capability: "manufacturing.view",
    order: 5.7,
    description: "Refill attar into bottles in one step — oil and bottles leave stock, each bottle gets its exact cost.",
    keywords: ["attar", "perfume", "refill", "bottle", "oil", "ml", "recipe"],
  },
  {
    id: "finance.reports",
    label: "Purchasing reports",
    kind: "page",
    parent: "finance.purchasing",
    domain: "manage",
    route: "/admin/finance/reports",
    capability: "purchasing.view",
    order: 6,
    description: "Purchase register, stock value, price changes and supplier payments as CSV.",
    keywords: ["report", "purchase register", "grni", "price variance", "inventory valuation", "stock value", "cost adjustments", "supplier payments", "csv"],
  },

  // Reports & books
  {
    id: "finance.center",
    label: "Owner's summary",
    kind: "page",
    parent: "finance.books",
    domain: "manage",
    route: "/admin/finance/center",
    capability: "finance.view",
    order: -2,
    description: "What you have put in, figures still to confirm, costs to split, renewals and the SMS balance.",
    keywords: ["investment", "invested", "owner", "estimate", "verify", "missing data", "allocate", "split cost", "vehicle", "renewal", "domain", "vps", "sms balance", "usd rate"],
  },
  {
    id: "finance.stock-check",
    label: "Stock check",
    kind: "page",
    parent: "finance.books",
    domain: "manage",
    route: "/admin/finance/stock-check",
    capability: "finance.view",
    order: -1.5,
    description: "Where every piece went — sold, on the way, in stock — what the materials must have been, and your counts beside the site.",
    keywords: ["stock", "reconcile", "count", "physical count", "tupi", "cap", "attar", "ml", "bottle", "box", "bubble poly", "roll", "how many bought", "direct steadfast"],
  },
  {
    id: "finance.profit",
    label: "Profit by order & product",
    kind: "page",
    parent: "finance.books",
    domain: "manage",
    route: "/admin/finance/profit",
    capability: "finance.view",
    order: -1,
    description: "What each order and product really earned after goods, packaging, courier, fees and ads.",
    keywords: ["profit", "margin", "contribution", "per order", "per product", "launch", "loss"],
  },
  {
    id: "finance.statements",
    label: "Financial statements",
    kind: "page",
    parent: "finance.books",
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
    parent: "finance.books",
    domain: "manage",
    route: "/admin/finance/budgets",
    capability: "finance.view",
    order: 1,
    description: "Plan vs actual, and how much cash you'll have in the coming weeks.",
    keywords: ["budget", "forecast", "cash flow forecast", "runway", "plan", "variance", "burn"],
  },
  {
    id: "finance.fixed-assets",
    label: "Fixed assets",
    kind: "page",
    parent: "finance.books",
    domain: "manage",
    route: "/admin/finance/fixed-assets",
    capability: "finance.view",
    order: 2,
    description: "Machines, furniture and vehicles you own, and their depreciation.",
    keywords: ["asset register", "depreciation", "equipment", "machine", "vehicle", "disposal", "book value"],
  },
  {
    id: "finance.ledger",
    label: "Ledger",
    kind: "page",
    parent: "finance.books",
    domain: "manage",
    route: "/admin/finance/ledger",
    capability: "finance.view",
    order: 3,
    description: "Every accounting account and its balance (for your accountant).",
    keywords: ["chart of accounts", "general ledger", "account balance"],
  },
  {
    id: "finance.journals",
    label: "Journals",
    kind: "page",
    parent: "finance.books",
    domain: "manage",
    route: "/admin/finance/journals",
    capability: "finance.view",
    order: 4,
    description: "Every entry in the books; add or correct a manual entry.",
    keywords: ["journal entry", "manual journal", "reverse", "double entry"],
  },

  // Payroll & partners
  {
    id: "finance.payroll",
    label: "Payroll",
    kind: "page",
    parent: "finance.people",
    domain: "manage",
    route: "/admin/finance/payroll",
    capability: "finance.sensitive",
    order: 0,
    description: "Employees, monthly salary runs and printable payslips.",
    keywords: ["salary", "salaries", "wages", "payslip", "employees", "staff", "provident fund", "pf", "bonus", "tax withheld"],
  },
  {
    id: "finance.equity",
    label: "Owner & partners",
    kind: "page",
    parent: "finance.people",
    domain: "manage",
    route: "/admin/finance/equity",
    capability: "finance.sensitive",
    order: 1,
    description: "What the owner put in and took out, and each partner's monthly profit share — earned, paid and owed.",
    keywords: ["partner", "capital", "owner", "drawings", "equity", "investment", "invest", "withdraw", "share", "profit share", "20%", "pay partner", "current account"],
  },

  // Setup & checks
  {
    id: "finance.rates",
    label: "Courier & gateway rates",
    kind: "page",
    parent: "finance.setup",
    domain: "manage",
    route: "/admin/finance/rates",
    capability: "finance.view",
    order: 0.5,
    description: "Steadfast's charges by area and EPS fees — so every order's cost shows the day it happens.",
    keywords: ["steadfast charge", "delivery charge", "cod charge", "return charge", "eps fee", "rate card"],
  },
  {
    id: "finance.opening",
    label: "Start the books",
    kind: "page",
    parent: "finance.setup",
    domain: "manage",
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
    parent: "finance.setup",
    domain: "manage",
    route: "/admin/finance/checks",
    capability: "finance.view",
    order: 1,
    description: "Automatic checks that the books match orders, stock and money accounts.",
    keywords: ["finance checks", "reconciliation", "revenue check", "cogs check"],
  },
  {
    id: "finance.exceptions",
    label: "Missing costs & exceptions",
    kind: "page",
    parent: "finance.setup",
    domain: "manage",
    route: "/admin/finance/exceptions",
    capability: "finance.view",
    order: 2,
    description: "Products sold without a cost, and other records the books couldn't post.",
    keywords: ["finance exceptions", "missing cost", "estimate", "unmatched"],
  },
  {
    id: "finance.inventory-cutover",
    label: "Opening stock value",
    kind: "page",
    parent: "finance.setup",
    domain: "manage",
    route: "/admin/finance/inventory-cutover",
    capability: "costing.view",
    order: 3,
    description: "One-time step: value the stock you already had so profit is calculated correctly.",
    keywords: ["valuation cutover", "inventory valuation", "costing", "average cost", "opening stock value"],
  },
  {
    id: "finance.tax-codes",
    label: "Purchase tax codes",
    kind: "page",
    parent: "finance.setup",
    domain: "manage",
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
    parent: "finance.setup",
    domain: "manage",
    route: "/admin/finance/mappings",
    capability: "finance.view",
    order: 5,
    description: "Which account in the books each kind of sale, cost or payment is recorded to.",
    keywords: ["mapping", "posting accounts", "chart of accounts", "default accounts"],
  },
  {
    id: "finance.activity",
    label: "Activity log",
    kind: "page",
    parent: "finance.setup",
    domain: "manage",
    route: "/admin/finance/activity",
    capability: "finance.view",
    order: 6,
    description: "Every change made in Finance and who made it, plus accounting events that failed to post.",
    keywords: ["audit", "history", "events", "failed events", "retry", "who changed"],
  },

  {
    id: "analytics",
    label: term("analytics"),
    kind: "module",
    domain: "manage",
    index: "/admin/analytics/overview",
    activeFor: ["/admin/analytics", "/admin/bi", "/admin/ai-assistant"],
    icon: "analytics",
    capability: "analytics.view",
    order: 90,
    goKey: "a",
    keywords: ["business intelligence", "bi", "reports"],
  },
  ...ANALYTICS_TABS.map(
    ([slug, label, keywords, deprecatedRoutes], i): NavNode => ({
      id: `analytics.${slug}`,
      label,
      kind: "report",
      parent: "analytics",
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
    order: ANALYTICS_TABS.length,
    keywords: ["ai", "chat"],
  },

  // ── System (sidebar footer) ─────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "settings",
    label: term("settings"),
    kind: "module",
    domain: "system",
    index: "/admin/settings",
    activeFor: ["/admin/settings", "/admin/payment-methods", "/admin/sms-notifications"],
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

  {
    id: "administration",
    label: term("administration"),
    kind: "module",
    domain: "system",
    index: "/admin/team",
    activeFor: ["/admin/team", "/admin/audit-log", "/admin/storage", "/admin/system-health"],
    icon: "administration",
    shortLabel: "Admin",
    order: 110,
    keywords: ["admin"],
  },
  { id: "administration.team", label: term("teamMember"), kind: "settings", parent: "administration", domain: "system", route: "/admin/team", capability: "team.manage", order: 0, keywords: ["staff", "admins"] },
  { id: "administration.audit-log", label: "Audit log", kind: "settings", parent: "administration", domain: "system", route: "/admin/audit-log", capability: "audit.view", order: 1, keywords: ["history"] },
  { id: "administration.storage", label: "Storage", kind: "settings", parent: "administration", domain: "system", route: "/admin/storage", capability: "settings.manage", order: 2, keywords: ["uploads", "media", "trash"] },
  {
    id: "administration.system-health",
    label: "System health",
    kind: "settings",
    parent: "administration",
    domain: "system",
    route: "/admin/system-health",
    capability: "ops.view",
    order: 3,
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
}

/** Visible to this admin on this installation (its own capability and flag — not its parents'). */
export function isNodeAllowed(node: NavNode, access: NavAccess): boolean {
  if (node.capability && !access.can(node.capability)) return false;
  if (node.featureFlag && !access.flagEnabled(node.featureFlag)) return false;
  return true;
}

const listed = (node: NavNode) => node.visibility !== "hidden";

export interface NavItem {
  node: NavNode;
  href: string;
  children: NavItem[];
}

function visibleChildren(id: string, access: NavAccess): NavItem[] {
  return childrenOf(id)
    .filter((c) => listed(c) && isNodeAllowed(c, access))
    .flatMap((c) => {
      const href = hrefOf(c);
      return href ? [{ node: c, href, children: visibleChildren(c.id, access) }] : [];
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

/** Palette page results: listed, static-route nodes this admin may open (with their module allowed too). */
export function searchableNodes(access: NavAccess): Array<{ node: NavNode; href: string; group: PaletteGroup }> {
  // Modules exactly as the sidebar shows them — a grouping module with no visible pages is absent, and one whose index
  // is hidden lands on its first visible page.
  const modules = new Map(navTree(access).flatMap((g) => g.modules.map((m) => [m.node.id, m.href] as const)));
  return NAV_NODES.filter((n) => {
    if (n.search === false || !listed(n) || n.kind === "detail" || n.kind === "create") return false;
    return modules.has(moduleOf(n).id) && ancestryOf(n).every((a) => isNodeAllowed(a, access));
  }).flatMap((n) => {
    const href = n.kind === "module" ? modules.get(n.id) : hrefOf(n);
    if (!href) return [];
    // Skip a page its parent already lands on (the parent's entry covers it — "Orders", not also "All orders").
    if (n.parent && navNode(n.parent)?.index === href) return [];
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
