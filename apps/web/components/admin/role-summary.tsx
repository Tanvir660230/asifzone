"use client";

import { useQuery } from "@tanstack/react-query";
import { listAdmins } from "@/lib/auth";

/** Permissions in plain words. The role map itself comes from the API (GET /api/auth/admins → roles), so this can't drift
 * from what the API enforces; a permission without a label is shown by its name rather than hidden. */
const LABEL: Record<string, string> = {
  "users.manage": "Invite admins and change their roles",
  "audit.read": "Read the audit log",
  "settings.manage": "Change store settings and branding",
  "storefront.configure": "Edit redirects and social links",
  "catalog.configure": "Set up product types, templates and guides",
  "products.import": "Import products from a file",
  "catalog.purge": "Permanently delete products and categories",
  "promotions.purge": "Permanently delete coupons",
  "orders.delete": "Trash, restore and permanently delete orders",
  "orders.escalations": "Decide on escalated confirmation calls (one more try, phone fixed)",
  "parcels.scan": "Scan parcels out to the courier and back in",
  "ai.use": "Use the AI assistant",
  "ai.execute": "Confirm changes the assistant proposes",
  "ops.repair": "Run repairs in System health",
  "inventory.approve": "Approve stock count losses over the limit",
  // the books (docs/FINANCE_PHASE_1.md §7)
  "finance.read": "See the books, statements and finance reports",
  "finance.transact": "Record money movements, expenses and draft journals",
  "finance.post": "Post journals and approve money movements",
  "finance.reverse": "Reverse posted journals and pay runs",
  "finance.configure": "Set up accounts, money accounts and partners",
  "finance.period_close": "Close and reopen accounting months",
  "finance.reconcile": "Run finance checks and reconcile bank statements",
  "finance.approve_high_value": "Approve large payments",
  "finance.sensitive": "See salaries, payroll and partners' balances",
  "suppliers.read": "See suppliers",
  "suppliers.manage": "Add and edit suppliers",
  "purchasing.read": "See purchase orders and goods receipts",
  "purchasing.manage": "Draft purchase orders and supplier returns",
  "purchasing.approve": "Approve purchase orders and supplier returns",
  "ap.read": "See supplier bills and what is owed",
  "ap.manage": "Enter supplier bills and pay suppliers",
  "costing.read": "See stock values and product costs",
  "costing.adjust": "Revalue stock and run the valuation cutover",
  "manufacturing.read": "See production",
  "manufacturing.manage": "Plan production and record its costs",
  "manufacturing.approve": "Approve and close production orders",
};
const FINANCE_INTRO: Record<string, string> = {
  FINANCE_ADMIN: "runs the books, purchasing and production — nothing else in the Store Console. Can:",
  ACCOUNTANT: "keeps the books day to day — nothing else in the Store Console. Can:",
  FINANCE_VIEWER: "reads the books and reports, and changes nothing. Can:",
};
/** Display names of the roles — the one list the account menu, the Team page and the forms use (naming only; what a role
 * may do comes from the API's role map). */
export const ROLE_NAMES: Record<string, string> = {
  OWNER: "Owner",
  STAFF: "Staff",
  MANAGER: "Manager",
  FINANCE_ADMIN: "Finance admin",
  ACCOUNTANT: "Accountant",
  FINANCE_VIEWER: "Finance viewer",
};
/** A store role that also keeps the books (MANAGER) says so; plain STAFF doesn't touch them. */
const STORE_INTRO: Record<string, string> = {
  MANAGER: "runs the store and the books day to day — orders, products, stock, customers, marketing, payments and finance entries — but can’t:",
};

/** Blueprint V2 security: the invite and edit forms show what the chosen role can do. Reads the role catalog from the same
 * query the Team page already made (no second request). */
export function RoleSummary({ role }: { role: string }) {
  const catalog = useQuery({ queryKey: ["admin-team"], queryFn: listAdmins });
  const roles = catalog.data?.roles ?? [];
  const entry = new Map(roles.map((r) => [r.role, r])).get(role); // the catalog entry of the role being chosen
  if (!entry) return null;
  const store = roles.find((r) => r.kind === "STORE");
  const keys = entry.kind === "ALL" ? store?.lacks ?? [] : entry.kind === "STORE" ? entry.lacks : entry.permissions.filter((p) => p in LABEL);
  const items = [...new Set(keys.map((p) => LABEL[p] ?? p))];
  return (
    <div className="rounded-xl bg-surface-muted px-3.5 py-3 text-[13px] text-fg-muted" aria-live="polite">
      <p>
        <span className="font-medium text-fg">{ROLE_NAMES[entry.role] ?? entry.role}:</span>{" "}
        {entry.kind === "ALL"
          ? <>everything in the Store Console, including what Staff can&rsquo;t do:</>
          : entry.kind === "STORE"
            ? STORE_INTRO[entry.role] ?? <>runs the store day to day — orders, products, stock, customers, marketing and payments — but can&rsquo;t:</>
            : FINANCE_INTRO[entry.role] ?? "Can:"}
      </p>
      <ul className="mt-1.5 grid list-disc gap-x-6 gap-y-0.5 pl-5 sm:grid-cols-2">
        {items.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  );
}
