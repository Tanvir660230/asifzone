"use client";

import { OWNER_ONLY_PERMISSIONS, type AdminRoleName } from "@clothing-brand/shared";

type OwnerOnly = (typeof OWNER_ONLY_PERMISSIONS)[number];

/** What sets an Owner apart from Staff, in plain words — read from the role map, so it can't drift from what the API
 * enforces (a type error flags a new owner-only permission without a label). */
const OWNER_ONLY_LABEL: Record<OwnerOnly, string> = {
  "users.manage": "Invite admins and change their roles",
  "audit.read": "Read the audit log",
  "settings.manage": "Change store settings and branding",
  "storefront.configure": "Edit redirects and social links",
  "catalog.configure": "Set up product types, templates and guides",
  "products.import": "Import products from a file",
  "catalog.purge": "Permanently delete products and categories",
  "promotions.purge": "Permanently delete coupons",
  "orders.delete": "Trash, restore and permanently delete orders",
  "ai.use": "Use the AI assistant",
  "ai.execute": "Confirm changes the assistant proposes",
  "ops.repair": "Run repairs in System health",
};

/** Blueprint V2 security: the invite and edit forms show what the chosen role can do. */
export function RoleSummary({ role }: { role: AdminRoleName }) {
  const items = OWNER_ONLY_PERMISSIONS.map((p) => OWNER_ONLY_LABEL[p]);
  return (
    <div className="rounded-xl bg-surface-muted px-3.5 py-3 text-[13px] text-fg-muted" aria-live="polite">
      {role === "OWNER" ? (
        <p>
          <span className="font-medium text-fg">Owner:</span> everything in the Store Console, including what Staff can&rsquo;t do:
        </p>
      ) : (
        <p>
          <span className="font-medium text-fg">Staff:</span> runs the store day to day — orders, products, stock, customers, marketing and
          payments — but can&rsquo;t:
        </p>
      )}
      <ul className="mt-1.5 grid list-disc gap-x-6 gap-y-0.5 pl-5 sm:grid-cols-2">
        {items.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  );
}
