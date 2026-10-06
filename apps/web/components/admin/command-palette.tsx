"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  CornerDownLeft,
  CreditCard,
  FolderTree,
  Gauge,
  Image as ImageIcon,
  LayoutDashboard,
  Layers,
  Megaphone,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Shirt,
  Star,
  Tag,
  User,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@clothing-brand/shared";
import { adminCan } from "@/lib/auth";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import * as productsApi from "@/lib/api/products";
import { formatPrice, orderStatusShortLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Extra words that should match, e.g. "stock" for Inventory. */
  keywords?: string;
}

/** Things worth creating from anywhere — also the Quick-create menu's list. */
export const CREATE_ENTRIES: PaletteEntry[] = [
  { id: "new-order", label: "New order", hint: "Manual / phone order", href: "/admin/orders/new", icon: ClipboardList, permission: "orders.manage" },
  { id: "new-product", label: "New product", hint: "Product Builder", href: "/admin/products/new", icon: Shirt, permission: "catalog.manage" },
  { id: "new-customer", label: "New customer", hint: "Customers", href: "/admin/customers", icon: User, permission: "customers.manage" },
  { id: "new-coupon", label: "New coupon", hint: "Promotions", href: "/admin/coupons", icon: Tag, permission: "promotions.manage" },
  { id: "new-flash-sale", label: "New flash sale", hint: "Promotions", href: "/admin/flash-sales", icon: Zap, permission: "promotions.manage" },
  { id: "new-banner", label: "New banner", hint: "Content", href: "/admin/banners", icon: ImageIcon, permission: "content.manage" },
];

const PAGE_ENTRIES: PaletteEntry[] = [
  { id: "p-dashboard", label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard, keywords: "home overview" },
  { id: "p-orders", label: "Orders", href: "/admin/orders", icon: ClipboardList, permission: "orders.read" },
  { id: "p-returns", label: "Return requests", href: "/admin/return-requests", icon: RotateCcw, permission: "orders.read", keywords: "exchange refund" },
  { id: "p-payments", label: "Payments", href: "/admin/payments/overview", icon: CreditCard, permission: "payments.read", keywords: "refund gateway" },
  { id: "p-customers", label: "Customers", href: "/admin/customers", icon: Users, permission: "customers.read", keywords: "crm" },
  { id: "p-products", label: "Products", href: "/admin/products", icon: Shirt, permission: "catalog.read", keywords: "catalog" },
  { id: "p-categories", label: "Categories", href: "/admin/categories", icon: FolderTree, permission: "catalog.read" },
  { id: "p-inventory", label: "Inventory", href: "/admin/inventory", icon: Boxes, permission: "inventory.read", keywords: "stock" },
  { id: "p-catalog-setup", label: "Catalog setup", href: "/admin/catalog/types", icon: Layers, keywords: "types templates attributes size guide" },
  { id: "p-promotions", label: "Promotions", href: "/admin/flash-sales", icon: Megaphone, keywords: "coupon flash sale bundle campaign discount" },
  { id: "p-content", label: "Homepage & content", href: "/admin/homepage", icon: ImageIcon, keywords: "banner sections" },
  { id: "p-reviews", label: "Reviews", href: "/admin/reviews", icon: Star, permission: "content.manage" },
  { id: "p-feedback", label: "Feedback & messages", href: "/admin/feedback", icon: MessageSquare, permission: "content.manage", keywords: "support" },
  { id: "p-bi", label: "Business Intelligence", href: "/admin/bi/overview", icon: Gauge, permission: "analytics.read", keywords: "analytics reports" },
  { id: "p-bi-sales", label: "Sales analytics", href: "/admin/bi/sales", icon: BarChart3, permission: "analytics.read" },
  { id: "p-bi-products", label: "Product analytics", href: "/admin/bi/products", icon: BarChart3, permission: "analytics.read" },
  { id: "p-bi-customers", label: "Customer analytics", href: "/admin/bi/customers", icon: BarChart3, permission: "analytics.read", keywords: "cohort retention rfm" },
  { id: "p-bi-marketing", label: "Marketing analytics", href: "/admin/bi/marketing", icon: BarChart3, permission: "analytics.read", keywords: "traffic campaign" },
  { id: "p-bi-visitors", label: "Visitors", href: "/admin/bi/visitors", icon: BarChart3, permission: "analytics.read", keywords: "traffic devices" },
  { id: "p-settings", label: "Settings", href: "/admin/settings", icon: Settings, keywords: "store sms payment methods social redirects" },
  { id: "p-team", label: "Team", href: "/admin/team", icon: Users, permission: "users.manage", keywords: "staff admins" },
];

function matches(entry: PaletteEntry, q: string): boolean {
  const hay = `${entry.label} ${entry.hint ?? ""} ${entry.keywords ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

interface ResultRow {
  id: string;
  group: string;
  label: string;
  meta?: ReactNode;
  href: string;
  icon: LucideIcon;
}

const SEARCH_LIMIT = 5;

/** Ctrl/⌘+K: jump to any admin page, create something, or find an order / customer / product by name, number or phone. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { data: me } = useCurrentAdmin();
  const admin = me?.admin;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const panelRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounced = useDebouncedValue(query.trim(), 250);
  const searching = debounced.length >= 2;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // After the trap's own initial focus, so the cursor lands in the search box.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const orders = useQuery({
    queryKey: ["palette", "orders", debounced],
    queryFn: () => adminOrdersApi.listOrders({ search: debounced, pageSize: SEARCH_LIMIT }),
    enabled: open && searching && adminCan(admin, "orders.read"),
    staleTime: 30_000,
  });
  const customers = useQuery({
    queryKey: ["palette", "customers", debounced],
    queryFn: () => adminCustomersApi.listCustomers({ search: debounced, pageSize: SEARCH_LIMIT }),
    enabled: open && searching && adminCan(admin, "customers.read"),
    staleTime: 30_000,
  });
  const products = useQuery({
    queryKey: ["palette", "products", debounced],
    queryFn: () => productsApi.listProducts({ search: debounced, pageSize: SEARCH_LIMIT }),
    enabled: open && searching && adminCan(admin, "catalog.read"),
    staleTime: 30_000,
  });
  const loading = searching && (orders.isFetching || customers.isFetching || products.isFetching);

  const rows = useMemo<ResultRow[]>(() => {
    const allowed = (e: PaletteEntry) => !e.permission || adminCan(admin, e.permission);
    const q = query.trim();
    const out: ResultRow[] = [];

    if (searching) {
      for (const o of orders.data?.items ?? []) {
        out.push({
          id: `o-${o.id}`,
          group: "Orders",
          label: `#${o.orderNumber} · ${o.customerName}`,
          meta: `${formatPrice(o.total)} · ${orderStatusShortLabel(o.status)}`,
          href: `/admin/orders/${o.id}`,
          icon: ClipboardList,
        });
      }
      for (const c of customers.data?.items ?? []) {
        out.push({ id: `c-${c.id}`, group: "Customers", label: c.name, meta: c.phone ?? c.email ?? undefined, href: `/admin/customers/${c.id}`, icon: User });
      }
      for (const p of products.data?.items ?? []) {
        out.push({ id: `pr-${p.id}`, group: "Products", label: p.name, meta: p.status?.toLowerCase(), href: `/admin/products/${p.id}`, icon: Shirt });
      }
    }

    const create = CREATE_ENTRIES.filter(allowed).filter((e) => !q || matches(e, q));
    const pages = PAGE_ENTRIES.filter(allowed).filter((e) => !q || matches(e, q));
    // Empty query: lead with creating, then a short list of destinations. Typed query: records first, then pages.
    for (const e of q ? pages : create) out.push({ id: e.id, group: q ? "Pages" : "Create", label: e.label, meta: e.hint, href: e.href, icon: q ? e.icon : Plus });
    for (const e of q ? create : pages.slice(0, 8)) out.push({ id: e.id, group: q ? "Create" : "Jump to", label: e.label, meta: e.hint, href: e.href, icon: q ? Plus : e.icon });
    return out;
  }, [admin, query, searching, orders.data, customers.data, products.data]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(row: ResultRow | undefined) {
    if (!row) return;
    onClose();
    router.push(row.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(rows[active]);
    }
  }

  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search and jump"
        tabIndex={-1}
        className="relative flex max-h-[70vh] w-full max-w-xl animate-modal-in flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-floatLg"
      >
        <div className="flex items-center gap-3 border-b border-line-subtle px-4">
          <Search size={18} className="shrink-0 text-ink-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search orders, customers, products — or jump to a page"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={rows[active] ? `cp-${rows[active].id}` : undefined}
          />
          {loading && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ink-200 border-t-ink-600" aria-hidden />}
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-400 sm:inline">Esc</kbd>
        </div>

        <ul ref={listRef} id="command-palette-list" role="listbox" className="flex-1 overflow-y-auto py-2">
          {rows.length === 0 ? (
            <li className="px-4 py-10 text-center text-sm text-ink-500">
              {loading ? "Searching…" : `Nothing matches “${query.trim()}”.`}
            </li>
          ) : (
            rows.map((row, i) => {
              const showGroup = row.group !== lastGroup;
              lastGroup = row.group;
              const Icon = row.icon;
              return (
                <li key={row.id} role="presentation">
                  {showGroup && (
                    <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400 first:pt-1">{row.group}</p>
                  )}
                  <button
                    id={`cp-${row.id}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    tabIndex={-1}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(row)}
                    className={cn(
                      "mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-100",
                      i === active ? "bg-ink-900 text-cream-50" : "text-ink-800",
                    )}
                  >
                    <Icon size={16} className={cn("shrink-0", i === active ? "text-cream-200" : "text-ink-400")} />
                    <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                    {row.meta && <span className={cn("shrink-0 truncate text-xs", i === active ? "text-cream-200" : "text-ink-400")}>{row.meta}</span>}
                    {i === active && <CornerDownLeft size={14} className="shrink-0 text-cream-200" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="hidden items-center gap-4 border-t border-line-subtle bg-surface-muted px-4 py-2 text-[11px] text-ink-400 sm:flex">
          <span>
            <kbd className="font-sans">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-sans">↵</kbd> open
          </span>
          <span className="ml-auto">Search by order #, name or phone</span>
        </div>
      </div>
    </div>
  );
}

/** Global Ctrl/⌘+K binding. Returns the open state so the header can also open it from a button. */
export function useCommandPaletteHotkey() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}
