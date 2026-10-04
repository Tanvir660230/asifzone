"use client";

import type { Permission } from "@clothing-brand/shared";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { adminCan } from "@/lib/auth";
import { SubNav } from "./sub-nav";

const TABS: Array<{ label: string; href: string; permission?: Permission }> = [
  { label: "Store & Branding", href: "/admin/settings" },
  { label: "SMS Notifications", href: "/admin/sms-notifications", permission: "settings.manage" },
  { label: "Payment Methods", href: "/admin/payment-methods" },
  { label: "Social Links", href: "/admin/social-links" },
  { label: "Redirects", href: "/admin/redirects" },
  { label: "Team", href: "/admin/team", permission: "users.manage" },
  { label: "Storage", href: "/admin/storage", permission: "storage.manage" },
  { label: "Audit Log", href: "/admin/audit-log", permission: "audit.read" },
];

/** Shared sub-nav across the "setup once, revisit rarely" admin pages that used to each have their
 * own top-level sidebar entry — see components/admin/sidebar.tsx for the other half of this change. */
export function SettingsSubNav() {
  const { data: currentAdmin } = useCurrentAdmin();
  const tabs = TABS.filter((t) => !t.permission || adminCan(currentAdmin?.admin, t.permission));

  return <SubNav tabs={tabs} />;
}
