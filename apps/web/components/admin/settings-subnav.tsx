"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCurrentAdmin } from "@/hooks/use-current-admin";

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
  const pathname = usePathname();
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";
  const tabs = TABS.filter((t) => !t.ownerOnly || isOwner);

  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-ink-100">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ease-smooth",
            pathname.startsWith(t.href)
              ? "border-ink-900 text-ink-900"
              : "border-transparent text-ink-400 hover:text-ink-700",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
