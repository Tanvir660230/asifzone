"use client";

import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { SubNav } from "./sub-nav";

const TABS = [
  { label: "Store & Branding", href: "/admin/settings" },
  { label: "SMS Notifications", href: "/admin/sms-notifications", ownerOnly: true },
  { label: "Payment Methods", href: "/admin/payment-methods" },
  { label: "Social Links", href: "/admin/social-links" },
  { label: "Redirects", href: "/admin/redirects" },
  { label: "Team", href: "/admin/team", ownerOnly: true },
  { label: "Audit Log", href: "/admin/audit-log", ownerOnly: true },
];

/** Shared sub-nav across the "setup once, revisit rarely" admin pages that used to each have their
 * own top-level sidebar entry — see components/admin/sidebar.tsx for the other half of this change. */
export function SettingsSubNav() {
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";
  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);

  return <SubNav tabs={tabs} />;
}
