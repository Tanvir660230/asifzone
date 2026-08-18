"use client";

import { useEffect, useState } from "react";
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
  LayoutTemplate,
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
  Boxes,
  PanelLeftClose,
  PanelLeftOpen,
  Gauge,
  UserSearch,
  Milestone,
  Search,
  PackageSearch,
  Megaphone as MegaphoneIcon,
  Receipt,
  DollarSign,
  Boxes as BoxesIcon,
  Activity,
  Heart,
  Sparkles,
  History,
  FileBarChart,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAdmin, logoutAllDevices } from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { useFocusTrap } from "@/hooks/use-focus-trap";
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
    label: "Business Intelligence",
    items: [
      { href: "/admin/bi/overview", label: "Overview", icon: Gauge },
      { href: "/admin/bi/visitors", label: "Visitors", icon: UserSearch },
      { href: "/admin/bi/journey", label: "Journey", icon: Milestone },
      { href: "/admin/bi/search", label: "Search", icon: Search },
      { href: "/admin/bi/products", label: "Product Intel", icon: PackageSearch },
      { href: "/admin/bi/customers", label: "Customer Intel", icon: Users },
      { href: "/admin/bi/marketing", label: "Marketing", icon: MegaphoneIcon },
      { href: "/admin/bi/sales", label: "Sales", icon: Receipt },
      { href: "/admin/bi/financial", label: "Financial", icon: DollarSign },
      { href: "/admin/bi/inventory", label: "Inventory Intel", icon: BoxesIcon },
      { href: "/admin/bi/operations", label: "Operations", icon: Activity },
      { href: "/admin/bi/behavior", label: "Behavior", icon: Heart },
      { href: "/admin/bi/ai-insights", label: "AI Insights", icon: Sparkles },
      { href: "/admin/bi/lifetime", label: "Lifetime", icon: History },
      { href: "/admin/bi/reports", label: "Reports", icon: FileBarChart },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/categories", label: "Categories", icon: FolderTree },
      { href: "/admin/products", label: "Products", icon: Shirt },
      { href: "/admin/inventory", label: "Inventory", icon: Boxes },
      { href: "/admin/attributes", label: "Attributes", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ClipboardList },
      { href: "/admin/payments/overview", label: "Payments", icon: CreditCard },
      { href: "/admin/customers", label: "Customers", icon: Users },
      { href: "/admin/flash-sales", label: "Flash Sales", icon: Zap },
      { href: "/admin/coupons", label: "Coupons", icon: Tag },
      { href: "/admin/bundles", label: "Bundles", icon: Gift },
      { href: "/admin/return-requests", label: "Returns", icon: RotateCcw },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate },
      { href: "/admin/banners", label: "Banners", icon: ImageIcon },
    ],
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

const COLLAPSE_STORAGE_KEY = "admin-sidebar-collapsed";

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
  const drawerRef = useFocusTrap<HTMLElement>({
    active: mobileOpen,
    onEscape: () => onCloseMobile?.(),
  });

  // Desktop-only compact mode — read from storage after mount (localStorage isn't available
  // during SSR, so starting expanded and correcting client-side avoids a hydration mismatch, at
  // the cost of a brief flash back to expanded for a returning admin who'd collapsed it before).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true") setCollapsed(true);
  }, []);
  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

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

  /** Rendered twice — once for the persistent desktop rail (which may be collapsed) and once for
   * the mobile drawer (always full width, never collapsed, regardless of the desktop preference). */
  function renderNav({ collapse, mobileDrawer }: { collapse: boolean; mobileDrawer: boolean }) {
    return (
      <>
        <div className={cn("flex h-[68px] shrink-0 items-center border-b border-ink-800/70", collapse ? "justify-center px-2" : "justify-between px-6")}>
          <span className="font-display text-lg tracking-wide text-cream-50">{collapse ? "SC" : "Store Console"}</span>
          {mobileDrawer && (
            <button onClick={onCloseMobile} className="text-cream-200" aria-label="Close menu">
              <X size={20} />
            </button>
          )}
        </div>

        <nav className={cn("flex-1 space-y-6 overflow-y-auto overflow-x-hidden py-4", collapse ? "px-2.5" : "px-3")}>
          {visibleSections.map((section) => (
            <div key={section.label}>
              {!collapse && (
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{section.label}</p>
              )}
              <div className="space-y-0.5">
                {section.items.map(({ href, label, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onCloseMobile}
                      title={collapse ? label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-all duration-200 ease-smooth",
                        collapse ? "justify-center px-0" : "px-3",
                        active ? "bg-white/[0.08] text-cream-50" : "text-cream-300/90 hover:translate-x-0.5 hover:bg-ink-800 hover:text-cream-50",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-cream-50" aria-hidden />
                      )}
                      <Icon size={18} className="shrink-0" />
                      {!collapse && <span className="truncate">{label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={cn("mb-3 mt-1 space-y-0.5 border-t border-ink-800/70 pt-3", collapse ? "mx-2.5" : "mx-3")}>
          <button
            onClick={handleLogout}
            title={collapse ? "Log out" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg py-2.5 text-sm text-cream-300/90 transition-colors duration-200 ease-smooth hover:bg-ink-800 hover:text-cream-50",
              collapse ? "justify-center px-0" : "px-3",
            )}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapse && "Log out"}
          </button>
          <button
            onClick={handleLogoutEverywhere}
            disabled={signingOutEverywhere}
            title={collapse ? "Log out of all devices" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg py-2.5 text-xs text-ink-500 transition-colors duration-200 ease-smooth hover:bg-ink-800 hover:text-cream-200 disabled:opacity-50",
              collapse ? "justify-center px-0" : "px-3",
            )}
          >
            <ShieldOff size={15} className="shrink-0" />
            {!collapse && (signingOutEverywhere ? "Signing out everywhere…" : "Log out of all devices")}
          </button>
          {!mobileDrawer && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className={cn(
                "mt-1 flex w-full items-center gap-3 rounded-lg py-2.5 text-xs text-ink-500 transition-colors duration-200 ease-smooth hover:bg-ink-800 hover:text-cream-200",
                collapse ? "justify-center px-0" : "px-3",
              )}
            >
              {collapse ? <PanelLeftOpen size={16} className="shrink-0" /> : <PanelLeftClose size={16} className="shrink-0" />}
              {!collapse && "Collapse"}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Desktop: static, collapsible sidebar */}
      <aside
        className={cn(
          "hidden h-screen shrink-0 flex-col border-r border-ink-800 bg-ink-950 text-cream-100 transition-[width] duration-300 ease-smooth lg:flex",
          collapsed ? "w-[76px]" : "w-60",
        )}
      >
        {renderNav({ collapse: collapsed, mobileDrawer: false })}
      </aside>

      {/* Mobile: off-canvas drawer — always full width/labels, independent of the desktop preference */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-sm" onClick={onCloseMobile} />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className="relative flex h-full w-64 animate-modal-in flex-col bg-ink-950 text-cream-100 shadow-floatLg"
          >
            {renderNav({ collapse: false, mobileDrawer: true })}
          </aside>
        </div>
      )}
      {confirmDialog}
    </>
  );
}
