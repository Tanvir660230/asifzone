import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ancestryOf,
  breadcrumbsFor,
  createCommands,
  deprecatedRedirect,
  documentTitleFor,
  goTargets,
  hrefOf,
  MAX_NAV_DEPTH,
  MAX_PRIMARY_MODULES,
  NAV_NODES,
  navNode,
  navTree,
  resolveNavNode,
  searchableNodes,
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

const access = (role: "OWNER" | "STAFF", flags: string[] = ["ai-assistant"]): NavAccess => ({
  can: (c: Capability) => can(c, { permissions: ROLE_PERMISSIONS[role], providers: { courier: true, sms: true, email: true, push: true } }),
  flagEnabled: (f) => flags.includes(f),
});

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
    expect(resolveNavNode("/admin/nowhere")).toBeUndefined();
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
    expect(owner).toEqual(["home", "orders", "products", "inventory", "customers", "messages", "marketing", "storefront", "finance", "analytics", "settings", "administration"]);
    // Team, audit log and storage are owner-only; staff see Administration only for System health (ops.read).
    expect(staff).toContain("administration");
    const staffAdmin = navTree(access("STAFF")).flatMap((g) => g.modules).find((m) => m.node.id === "administration");
    expect(staffAdmin?.children.map((c) => c.node.id) ?? []).toEqual(["administration.system-health"]);
    const staffSettings = navTree(access("STAFF")).flatMap((g) => g.modules).find((m) => m.node.id === "settings")!;
    expect(staffSettings.children.map((c) => c.node.id)).toEqual(["settings.store", "settings.payment-methods"]);
  });

  it("hides flagged nodes until the installation switches the flag on", () => {
    const analytics = (flags: string[]) => navTree(access("OWNER", flags)).flatMap((g) => g.modules).find((m) => m.node.id === "analytics")!;
    expect(analytics([]).children.map((c) => c.node.id)).not.toContain("analytics.ai-assistant");
    expect(analytics(["ai-assistant"]).children.map((c) => c.node.id)).toContain("analytics.ai-assistant");
  });

  it("section tabs: grouping page → its pages, a page → its siblings, a lone module → none", () => {
    expect(sectionTabsFor("/admin/catalog/types", access("OWNER")).map((t) => t.href)).toHaveLength(10);
    expect(sectionTabsFor("/admin/return-requests", access("OWNER")).map((t) => t.href)).toEqual(["/admin/orders", "/admin/return-requests"]);
    expect(sectionTabsFor("/admin/inventory", access("OWNER"))).toEqual([]);
  });

  it("create commands and palette entries respect capabilities; the product route is the Product Builder", () => {
    const owner = createCommands(access("OWNER"));
    expect(owner.map((c) => c.id)).toEqual(["create.order", "create.product", "create.customer", "create.coupon", "create.flash-sale", "create.banner"]);
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
