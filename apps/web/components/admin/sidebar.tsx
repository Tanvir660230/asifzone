"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderTree,
  Shirt,
  ClipboardList,
  Zap,
  Tag,
  Image as ImageIcon,
  LogOut,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAdmin } from "@/lib/auth";

const NAV_SECTIONS = [
  { label: "Overview", items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Catalog",
    items: [
      { href: "/admin/categories", label: "Categories", icon: FolderTree },
      { href: "/admin/products", label: "Products", icon: Shirt },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ClipboardList },
      { href: "/admin/flash-sales", label: "Flash Sales", icon: Zap },
      { href: "/admin/coupons", label: "Coupons", icon: Tag },
    ],
  },
  { label: "Content", items: [{ href: "/admin/banners", label: "Banners", icon: ImageIcon }] },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await logoutAdmin();
    router.replace("/admin/login");
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
        {NAV_SECTIONS.map((section) => (
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
                      "flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors",
                      active ? "bg-brass-400 text-ink-900" : "text-cream-200 hover:bg-ink-800",
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

      <button
        onClick={handleLogout}
        className="mx-3 mb-4 flex items-center gap-3 rounded px-3 py-2 text-sm text-cream-200 transition-colors hover:bg-ink-800"
      >
        <LogOut size={18} />
        Log out
      </button>
    </>
  );

  return (
    <>
      {/* Desktop: static sidebar */}
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-ink-100 bg-ink-900 text-cream-100 lg:flex">
        {content}
      </aside>

      {/* Mobile: off-canvas drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={onCloseMobile} />
          <aside className="relative flex h-full w-64 flex-col bg-ink-900 text-cream-100 shadow-xl">{content}</aside>
        </div>
      )}
    </>
  );
}
