"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderTree,
  Shirt,
  ClipboardList,
  Zap,
  Tag,
  Gift,
  RotateCcw,
  Image as ImageIcon,
  Users,
  SlidersHorizontal,
  ShieldOff,
  Settings,
  LogOut,
  X,
  Bot,
  Megaphone,
  MessageSquare,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAdmin, logoutAllDevices } from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";

/** Matches the backend's requireRole("OWNER") gates (audit log, team) — hidden rather than
 * shown-then-403'd, since a STAFF account can never use them regardless. "/admin/settings" is
 * deliberately NOT here even though its own store-info form is owner-only: it's also the shared
 * entry point to Payment Methods/Social Links/Redirects, which STAFF can use (see SettingsSubNav). */
const OWNER_ONLY_HREFS = new Set(["/admin/audit-log", "/admin/team"]);

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/ai-assistant", label: "AI Assistant", icon: Bot },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/categories", label: "Categories", icon: FolderTree },
      { href: "/admin/products", label: "Products", icon: Shirt },
      { href: "/admin/attributes", label: "Attributes", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ClipboardList },
      { href: "/admin/customers", label: "Customers", icon: Users },
      { href: "/admin/flash-sales", label: "Flash Sales", icon: Zap },
      { href: "/admin/coupons", label: "Coupons", icon: Tag },
      { href: "/admin/bundles", label: "Bundles", icon: Gift },
      { href: "/admin/return-requests", label: "Returns", icon: RotateCcw },
    ],
  },
  {
    label: "Content",
    items: [{ href: "/admin/banners", label: "Banners", icon: ImageIcon }],
  },
  {
    label: "Marketing",
    items: [{ href: "/admin/campaigns", label: "Campaigns", icon: Megaphone }],
  },
  {
    label: "Support",
    items: [
      { href: "/admin/feedback", label: "Feedback", icon: MessageSquare },
      { href: "/admin/reviews", label: "Reviews", icon: Star },
    ],
  },
  {
    label: "System",
    // Payment Methods, Social Links, Redirects, Team, and Audit Log all live behind this one entry
    // now via SettingsSubNav — "configure once, revisit rarely" pages no longer each get top-level
    // sidebar real estate. See settings-subnav.tsx.
    items: [{ href: "/admin/settings", label: "Settings", icon: Settings }],
  },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isOwner || !OWNER_ONLY_HREFS.has(item.href)),
  })).filter((section) => section.items.length > 0);

  async function handleLogout() {
    await logoutAdmin();
    router.replace("/admin/login");
  }

  async function handleLogoutEverywhere() {
    if (!(await confirm("Sign out of every device and browser signed in as you? You'll need to log in again here too.")))
      return;
    setSigningOutEverywhere(true);
    try {
      await logoutAllDevices();
      router.replace("/admin/login");
    } catch {
      toast.error("Couldn't sign out of all devices — try again.");
      setSigningOutEverywhere(false);
    }
  }

  const content = (
    <>
      <div className="flex items-center justify-between border-b border-ink-800 px-6 py-5">
        <span className="font-display text-lg tracking-wide text-cream-50">Store Console</span>
        {onCloseMobile && (
          <button onClick={onCloseMobile} className="text-cream-200 lg:hidden" aria-label="Close menu">
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {visibleSections.map((section) => (
          <div key={section.label}>
            <p className="mb-1 px-3 text-xs uppercase tracking-wide text-ink-500">{section.label}</p>
            <div className="space-y-1">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onCloseMobile}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 ease-smooth",
                      active
                        ? "bg-brass-400 text-ink-900 shadow-sm"
                        : "text-cream-200 hover:translate-x-0.5 hover:bg-ink-800",
                    )}
                  >
                    <Icon size={18} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mx-3 mb-4 space-y-0.5">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-cream-200 transition-colors duration-200 ease-smooth hover:bg-ink-800"
        >
          <LogOut size={18} />
          Log out
        </button>
        <button
          onClick={handleLogoutEverywhere}
          disabled={signingOutEverywhere}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-ink-400 transition-colors duration-200 ease-smooth hover:bg-ink-800 hover:text-cream-200 disabled:opacity-50"
        >
          <ShieldOff size={15} />
          {signingOutEverywhere ? "Signing out everywhere…" : "Log out of all devices"}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: static sidebar */}
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 text-cream-100 lg:flex">
        {content}
      </aside>

      {/* Mobile: off-canvas drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-sm" onClick={onCloseMobile} />
          <aside className="relative flex h-full w-64 animate-modal-in flex-col bg-ink-950 text-cream-100 shadow-floatLg">
            {content}
          </aside>
        </div>
      )}
      {confirmDialog}
    </>
  );
}
