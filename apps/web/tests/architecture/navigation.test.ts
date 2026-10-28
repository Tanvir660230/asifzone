import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ancestryOf,
  breadcrumbsFor,
  createCommands,
  deprecatedRedirect,
  FORM_WIDTH_ROUTES,
  pageWidthFor,
  documentTitleFor,
  goTargets,
  hrefOf,
  MAX_NAV_DEPTH,
  MAX_PRIMARY_MODULES,
  NAV_NODES,
  navChildren,
  navNode,
  navTree,
  resolveNavNode,
  searchableNodes,
  sectionBarFor,
  sectionTabsFor,
  type NavAccess,
} from "@/lib/admin/navigation";
import { CAPABILITIES, can, isCapability, type Capability } from "@/lib/admin/capabilities";
import { isFeatureFlag } from "@/lib/admin/features";
import { ROLE_PERMISSIONS } from "@clothing-brand/shared";

// P1.14 — the navigation manifest is the single source of admin navigation; these guards keep it honest.

const SHELL = join(import.meta.dirname, "..", "..", "app", "admin", "(shell)");

/** Every admin page under the shell as its route pattern ("/admin/orders/[id]"). */
function shellRoutes(dir = SHELL): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return shellRoutes(path);
    if (entry !== "page.tsx") return [];
    const segments = relative(SHELL, dir).split(sep).filter(Boolean).filter((s) => !/^\(.+\)$/.test(s));
    return [`/admin${segments.length ? `/${segments.join("/")}` : ""}`];
  });
}

const access = (role: keyof typeof ROLE_PERMISSIONS, flags: string[] = ["ai-assistant"], production = true): NavAccess => ({
  can: (c: Capability) => can(c, { permissions: ROLE_PERMISSIONS[role], providers: { courier: true, sms: true, email: true, push: true } }),
  flagEnabled: (f) => flags.includes(f),
  storeHas: (c) => c === "production" && production,
});
const modulesOf = (a: NavAccess) => navTree(a).flatMap((g) => g.modules);
const childIds = (a: NavAccess, id: string) => modulesOf(a).find((m) => m.node.id === id)?.children.map((c) => c.node.id) ?? [];

describe("navigation manifest — structure", () => {
  it("has unique node ids and unique routes", () => {
    const ids = NAV_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = NAV_NODES.flatMap((n) => (n.route ? [n.route] : []));
    expect(routes.filter((r, i) => routes.indexOf(r) !== i)).toEqual([]);
  });

  it("every parent exists, modules have none, and nothing is deeper than module › page › tab", () => {
    for (const node of NAV_NODES) {
      if (node.kind === "module") expect(node.parent, node.id).toBeUndefined();
      else expect(node.parent && navNode(node.parent), `${node.id} → parent ${node.parent}`).toBeTruthy();
      expect(ancestryOf(node).length, node.id).toBeLessThanOrEqual(MAX_NAV_DEPTH);
      if (node.parent) expect(navNode(node.parent)!.domain, node.id).toBe(node.domain);
    }
  });

  it(`has at most ${MAX_PRIMARY_MODULES} primary modules, each reachable (a route or an index among its pages)`, () => {
    const modules = NAV_NODES.filter((n) => n.kind === "module");
    expect(modules.length).toBeLessThanOrEqual(MAX_PRIMARY_MODULES);
    for (const mod of modules) {
      expect(hrefOf(mod), mod.id).toBeTruthy();
      if (mod.index) {
        const descendants = NAV_NODES.filter((n) => n.id !== mod.id && ancestryOf(n).includes(mod));
        const target = [mod, ...descendants].some((n) => n.route === mod.index || n.index === mod.index);
        expect(target, `${mod.id}.index ${mod.index} names one of its pages`).toBe(true);
      }
    }
  });

  it("names only real capabilities and feature flags, and go-keys are unique", () => {
    for (const node of NAV_NODES) {
      if (node.capability) expect(isCapability(node.capability), node.id).toBe(true);
      if (node.featureFlag) expect(isFeatureFlag(node.featureFlag), node.id).toBe(true);
      for (const command of node.commands ?? []) if (command.capability) expect(isCapability(command.capability), command.id).toBe(true);
    }
    const keys = NAV_NODES.flatMap((n) => (n.goKey ? [n.goKey] : []));
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(Object.keys(CAPABILITIES).length).toBeGreaterThan(0);
  });
});

describe("navigation manifest — coverage of the app", () => {
  const routes = shellRoutes();
  const deprecated = new Set(NAV_NODES.flatMap((n) => n.deprecatedRoutes ?? []));

  it("finds the admin pages", () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it("every admin page has a navigation node (or is a declared deprecated route)", () => {
    const missing = routes.filter((r) => !deprecated.has(r) && !NAV_NODES.some((n) => n.route === r));
    expect(missing).toEqual([]);
  });

  it("every form-width route is a real page", () => {
    expect(FORM_WIDTH_ROUTES.filter((r) => !routes.includes(r))).toEqual([]);
    expect(pageWidthFor("/admin/settings")).toBe("form");
    expect(pageWidthFor("/admin/orders")).toBe("full");
  });

  it("every node route is a real page", () => {
    const orphans = NAV_NODES.flatMap((n) => (n.route ? [n.route] : [])).filter((r) => !routes.includes(r));
    expect(orphans).toEqual([]);
  });

  it("deprecated routes redirect to their node's route, keeping params and query", () => {
    expect(deprecatedRedirect("/admin/products/wizard/new", "?step=media")).toBe("/admin/products/new?step=media");
    expect(deprecatedRedirect("/admin/products/wizard/abc123/edit", "?step=2")).toBe("/admin/products/abc123/edit?step=2");
    expect(deprecatedRedirect("/admin/products")).toBeNull();
    for (const old of deprecated) expect(resolveNavNode(old.split("?")[0]!.replace(/\[[^\]]+\]/g, "x")), old).toBeDefined();
    // Analytics (DR-26): a merged BI page lands on its tab's view; the visitor's own query is kept.
    expect(deprecatedRedirect("/admin/bi/financial")).toBe("/admin/analytics/sales?view=financial");
    expect(deprecatedRedirect("/admin/bi/visitors", "?from=2026-10-01")).toBe("/admin/analytics/marketing?from=2026-10-01&view=visitors");
    expect(deprecatedRedirect("/admin/bi/overview")).toBe("/admin/analytics/overview");
  });
});

describe("navigation manifest — derivation", () => {
  it("resolves pages, details and grouped prefixes to the right node", () => {
    expect(resolveNavNode("/admin/orders")?.id).toBe("orders.all");
    expect(resolveNavNode("/admin/orders/abc")?.id).toBe("orders.detail");
    expect(resolveNavNode("/admin/catalog/size-guides")?.id).toBe("products.catalog-setup.size-guides");
    expect(resolveNavNode("/admin/products/p1/edit")?.id).toBe("products.edit");
    expect(resolveNavNode("/admin/payments/overview")?.id).toBe("finance.overview");
    expect(resolveNavNode("/admin/payments/refunds")?.id).toBe("finance.refunds");
    expect(resolveNavNode("/admin/finance/accounts")?.id).toBe("finance.accounts");
    expect(resolveNavNode("/admin/finance/accounts/fa1")?.id).toBe("finance.account-detail");
    expect(resolveNavNode("/admin/finance/reconciliation/r1")?.id).toBe("finance.reconciliation-detail");
    expect(resolveNavNode("/admin/finance/sales")?.id).toBe("finance.sales");
    expect(resolveNavNode("/admin/finance/settlements")?.id).toBe("finance.settlements");
    expect(resolveNavNode("/admin/finance/exceptions")?.id).toBe("finance.exceptions");
    expect(resolveNavNode("/admin/finance/checks")?.id).toBe("finance.checks");
    expect(resolveNavNode("/admin/finance/suppliers")?.id).toBe("finance.suppliers");
    expect(resolveNavNode("/admin/finance/tax-codes")?.id).toBe("finance.tax-codes");
    expect(resolveNavNode("/admin/nowhere")).toBeUndefined();
  });

  it("organises Money, Books and Reports (blueprint tab 2 §2) — every URL unchanged, only the menu moved", () => {
    expect(resolveNavNode("/admin/finance")?.id).toBe("finance.home");
    expect(navNode("finance")?.label).toBe("Money");
    const owner = access("OWNER");
    expect(navChildren("finance", owner).map((c) => c.node.label)).toEqual(["Overview", "Accounts & cash", "Expenses", "Bills to pay", "Payments & refunds", "Courier & gateway", "Loans", "Prepaid costs", "Bank reconciliation"]);
    expect(navChildren("books", owner).map((c) => c.node.label)).toEqual(["Month-end", "Needs attention", "Owner & partners", "Payroll", "Statements", "Ledger & journals", "Fixed assets", "Budgets & cash forecast", "Missing costs & exceptions", "Records & allocations"]);
    expect(navChildren("analytics", owner).map((c) => c.node.label)).toEqual(["Profit", "Product costs & price planner", "Store analytics", "Purchasing reports", "AI assistant"]);
    expect(resolveNavNode("/admin/finance/my-cash")?.parent).toBe("finance.money");
    expect(deprecatedRedirect("/admin/finance/refills")).toBe("/admin/stock?open=filled");
    for (const route of ["/admin/payments/transactions", "/admin/payments/refunds", "/admin/payments/attempts", "/admin/payments/overview"]) expect(resolveNavNode(route)?.parent, route).toBe("finance.selling");
    for (const route of ["/admin/finance/settlements", "/admin/finance/courier", "/admin/finance/courier-costs"]) expect(resolveNavNode(route)?.parent, route).toBe("finance.courier-gateway");
    // the formal purchasing path sits under Stock › More; suppliers under Stock; ads under Marketing
    expect(resolveNavNode("/admin/finance/goods-receipts")?.parent).toBe("inventory.more");
    expect(resolveNavNode("/admin/finance/suppliers")?.parent).toBe("inventory");
    expect(resolveNavNode("/admin/finance/ads")?.parent).toBe("marketing");
    // one-time books setup lives in Settings
    expect(navChildren("settings.books", owner).map((c) => c.href)).toEqual([
      "/admin/finance/opening", "/admin/finance/inventory-cutover", "/admin/finance/mappings", "/admin/finance/rates", "/admin/finance/tax-codes", "/admin/finance/checks", "/admin/finance/activity",
    ]);
    // every listed money and books page explains itself in one sentence (the Overview's map shows it)
    const listed = ["finance", "books", "settings.books", "inventory.more"].flatMap((g) => navChildren(g, owner)).flatMap((i) => (i.children.length ? i.children : [i]));
    for (const item of listed) expect(item.node.description, item.node.id).toBeTruthy();
  });

  it("blueprint P0.6 (Q8): a finance-only role reaches its money and books pages without any new permission", () => {
    const roles = (["FINANCE_ADMIN", "ACCOUNTANT", "FINANCE_VIEWER"] as const).filter((r) => r in ROLE_PERMISSIONS);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      const a = access(role);
      expect(modulesOf(a).map((m) => m.node.id), role).toContain("books");
      expect(childIds(a, "books"), role).toContain("books.statements");
      // nothing they can't open is linked: every visible page's own capability is one the role holds
      for (const m of modulesOf(a)) for (const c of m.children) if (c.node.capability) expect(a.can(c.node.capability), role + " " + c.node.id).toBe(true);
    }
  });

  it("owner decision Q-G: Production shows only when the admin may see it AND the store has production", () => {
    expect(childIds(access("OWNER"), "inventory")).toContain("inventory.production");
    expect(childIds(access("OWNER", ["ai-assistant"], false), "inventory")).not.toContain("inventory.production");
    // not known yet (no store answer) → hidden, never flashed on a store without production
    const unknown: NavAccess = { ...access("OWNER"), storeHas: undefined };
    expect(childIds(unknown, "inventory")).not.toContain("inventory.production");
  });

  it("builds breadcrumbs and titles from the tree", () => {
    expect(breadcrumbsFor("/admin/orders").map((c) => c.label)).toEqual(["Orders"]);
    expect(breadcrumbsFor("/admin/orders/abc")).toEqual([{ label: "Orders", href: "/admin/orders" }, { label: "Order" }]);
    expect(breadcrumbsFor("/admin/catalog/sku").map((c) => c.label)).toEqual(["Products", "Catalog setup", "SKUs"]);
    expect(documentTitleFor("/admin/return-requests")).toBe("Return requests · Store Console");
    expect(documentTitleFor("/admin/unknown")).toBe("Store Console");
  });

  it("derives the sidebar per role: owner-only pages hidden from staff, empty modules dropped", () => {
    const owner = navTree(access("OWNER")).flatMap((g) => g.modules.map((m) => m.node.id));
    const staff = navTree(access("STAFF")).flatMap((g) => g.modules.map((m) => m.node.id));
    // tab 21 §2: Home; Sell; Make & stock; Grow; Money; Settings in the footer — twelve sections
    expect(owner).toEqual(["home", "orders", "messages", "customers", "products", "inventory", "marketing", "storefront", "finance", "books", "analytics", "settings"]);
    expect(navTree(access("OWNER")).map((g) => g.label)).toEqual([null, "Sell", "Make & stock", "Grow", "Money", null]);
    // Staff keep Money › Payments & refunds (blueprint Q8 note) and never see the books
    expect(staff).toContain("finance");
    expect(staff).not.toContain("books");
    expect(childIds(access("STAFF"), "finance")).toContain("finance.selling");
    expect(childIds(access("STAFF"), "finance")).not.toContain("finance.home");
    // Team, audit log and storage are owner-only; staff see Settings › System only for System health (ops.read).
    expect(childIds(access("STAFF"), "settings")).toEqual(["settings.store", "settings.payment-methods", "settings.system"]);
  });

  it("hides flagged nodes until the installation switches the flag on", () => {
    const analytics = (flags: string[]) => modulesOf(access("OWNER", flags)).find((m) => m.node.id === "analytics")!;
    expect(analytics([]).children.map((c) => c.node.id)).not.toContain("analytics.ai-assistant");
    expect(analytics(["ai-assistant"]).children.map((c) => c.node.id)).toContain("analytics.ai-assistant");
  });

  it("section tabs: grouping page → its pages, a page → its siblings, a lone module → none", () => {
    expect(sectionTabsFor("/admin/catalog/types", access("OWNER")).map((t) => t.href)).toHaveLength(11);
    expect(sectionTabsFor("/admin/return-requests", access("OWNER")).map((t) => t.href)).toEqual(["/admin/orders", "/admin/return-requests"]);
    // Inventory groups stock and production (docs/MANUFACTURING.md, STOCK_HUB §7): Stock, Stock levels, Stock check (admin
    // audit phase 3: where every piece went, moved from Finance) and Production, whose own pages are its tabs; a lone module
    // still shows none (Customers).
    expect(sectionTabsFor("/admin/inventory", access("OWNER")).map((t) => t.href)).toEqual(["/admin/stock", "/admin/stock/purchases", "/admin/finance/suppliers", "/admin/manufacturing/home", "/admin/inventory", "/admin/finance/purchase-orders"]);
    expect(sectionTabsFor("/admin/manufacturing/boms", access("OWNER")).map((t) => t.href)).toEqual(["/admin/manufacturing/home", "/admin/manufacturing", "/admin/manufacturing/production-orders", "/admin/manufacturing/boms", "/admin/manufacturing/materials"]);
    expect(sectionTabsFor("/admin/customers", access("OWNER"))).toEqual([]);
  });

  it("section bar: the module's pages with the current one, on every page in them, never on create or detail views", () => {
    const products = sectionBarFor("/admin/categories", access("OWNER"));
    expect(products?.module.id).toBe("products");
    expect(products?.tabs.map((t) => t.href)).toContain("/admin/products/import");
    expect(products?.activeHref).toBe("/admin/categories");
    // A deeper page keeps its module-level tab: Catalog setup's pages light up "Catalog setup".
    const setup = sectionBarFor("/admin/catalog/materials", access("OWNER"));
    expect(setup?.tabs.find((t) => t.href === setup.activeHref)?.node.id).toBe("products.catalog-setup");
    expect(sectionBarFor("/admin/return-requests", access("OWNER"))?.activeHref).toBe("/admin/return-requests");
    expect(sectionBarFor("/admin/orders/new", access("OWNER"))).toBeNull();
    expect(sectionBarFor("/admin/orders/abc123", access("OWNER"))).toBeNull();
    expect(sectionBarFor("/admin/products/abc123/edit", access("OWNER"))).toBeNull();
    // Inventory holds Stock and Manufacturing (docs/MANUFACTURING.md), so it has a section bar of its own
    expect(sectionBarFor("/admin/inventory", access("OWNER"))?.tabs.map((t) => t.href)).toEqual(["/admin/stock", "/admin/stock/purchases", "/admin/finance/suppliers", "/admin/manufacturing/home", "/admin/inventory", "/admin/finance/purchase-orders"]);
    // a Production page keeps the module bar on "Production"
    expect(sectionBarFor("/admin/manufacturing/materials", access("OWNER"))?.activeHref).toBe("/admin/manufacturing/home");
    expect(sectionBarFor("/admin/manufacturing/production-orders/po1", access("OWNER"))).toBeNull(); // a detail view
  });

  it("create commands and palette entries respect capabilities; the product route is the Product Builder", () => {
    const owner = createCommands(access("OWNER"));
    expect(owner.map((c) => c.id)).toEqual([
      "create.order", "create.product", "create.customer", "create.coupon", "create.flash-sale", "create.banner",
      // the everyday finance actions (deep links into the page with its dialog open)
      "create.expense", "create.money-in", "create.money-out", "create.purchase-order", "create.supplier-bill",
    ]);
    expect(owner.find((c) => c.id === "create.expense")?.route).toBe("/admin/finance/expenses?new=expense");
    // owner-only books stay out of Staff's Create menu; purchasing (a Staff job) stays in
    const staff = createCommands(access("STAFF")).map((c) => c.id);
    expect(staff).not.toContain("create.expense");
    expect(staff).not.toContain("create.supplier-bill");
    expect(staff).toContain("create.purchase-order");
    expect(owner.find((c) => c.id === "create.product")?.route).toBe("/admin/products/new");
    const staffPages = searchableNodes(access("STAFF")).map((e) => e.href);
    expect(staffPages).not.toContain("/admin/team");
    expect(staffPages).toContain("/admin/orders");
    const hrefs = searchableNodes(access("OWNER")).map((e) => e.href);
    expect(hrefs.filter((h, i) => hrefs.indexOf(h) !== i)).toEqual([]);
  });

  it("go-to chords point at reachable modules", () => {
    const targets = goTargets(access("OWNER"));
    expect(targets.find((t) => t.key === "o")?.href).toBe("/admin/orders");
    expect(targets.find((t) => t.key === "s")?.href).toBe("/admin/settings");
  });
});
