"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardList, CornerDownLeft, FileText, Plus, Search, Settings, Shirt, User, type LucideIcon } from "lucide-react";
import { useCapabilities } from "@/hooks/use-capability";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useNavAccess } from "@/hooks/use-nav-access";
import { useShortcut } from "@/hooks/use-shortcut";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import * as productsApi from "@/lib/api/products";
import { productEditHref } from "@/lib/admin-routes";
import { createCommands, moduleOf, searchableNodes, type NavCommand, type NavNode, type PaletteGroup } from "@/lib/admin/navigation";
import { paletteKeys } from "@/lib/query-keys";
import { formatPrice, orderStatusShortLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";

/**
 * Ctrl/⌘+K: jump to any admin page, create something, or find an order / customer / product by name, number or phone.
 * Pages, reports, settings and create actions are DERIVED from the navigation manifest (lib/admin/navigation.ts) and the
 * capability registry — this file holds no route list. Record search stays on the list endpoints until a dedicated
 * search API exists.
 */

interface ResultRow {
  id: string;
  group: string;
  label: string;
  meta?: ReactNode;
  href: string;
  icon: LucideIcon;
}

interface Entry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
  group: PaletteGroup | "Create";
}

const SEARCH_LIMIT = 5;
const GROUP_ICON: Partial<Record<PaletteGroup, LucideIcon>> = { Reports: BarChart3, Settings };

function iconFor(node: NavNode, group: PaletteGroup): LucideIcon {
  const own = node.icon ?? moduleOf(node).icon;
  if (group === "Pages" && own) return NAV_ICONS[own];
  return GROUP_ICON[group] ?? (own ? NAV_ICONS[own] : FileText);
}

function matches(entry: Entry, q: string): boolean {
  const hay = `${entry.label} ${entry.hint ?? ""} ${entry.keywords}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** The Create menu's and the palette's create actions for this admin — from the manifest's node commands. */
export function useCreateCommands(): Array<NavCommand & { node: NavNode }> {
  const access = useNavAccess();
  return useMemo(() => createCommands(access), [access]);
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const access = useNavAccess();
  const { can } = useCapabilities();
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
    queryKey: paletteKeys.search("orders", debounced),
    queryFn: ({ signal }) => adminOrdersApi.listOrders({ search: debounced, pageSize: SEARCH_LIMIT }, { signal }),
    enabled: open && searching && can("orders.view"),
    staleTime: 30_000,
  });
  const customers = useQuery({
    queryKey: paletteKeys.search("customers", debounced),
    queryFn: ({ signal }) => adminCustomersApi.listCustomers({ search: debounced, pageSize: SEARCH_LIMIT }, { signal }),
    enabled: open && searching && can("customers.view"),
    staleTime: 30_000,
  });
  const products = useQuery({
    queryKey: paletteKeys.search("products", debounced),
    queryFn: ({ signal }) => productsApi.listProducts({ search: debounced, pageSize: SEARCH_LIMIT }, { signal }),
    enabled: open && searching && can("catalog.view"),
    staleTime: 30_000,
  });
  const loading = searching && (orders.isFetching || customers.isFetching || products.isFetching);

  const entries = useMemo<{ pages: Entry[]; create: Entry[] }>(() => {
    const pages = searchableNodes(access).map(({ node, href, group }) => ({
      id: node.id,
      label: node.label,
      hint: group === "Pages" && node.parent ? moduleOf(node).label : undefined,
      href,
      icon: iconFor(node, group),
      keywords: (node.keywords ?? []).join(" "),
      group,
    }));
    const create = createCommands(access).map((c) => ({
      id: c.id,
      label: c.label,
      hint: c.hint,
      href: c.route,
      icon: Plus,
      keywords: (c.keywords ?? []).join(" "),
      group: "Create" as const,
    }));
    return { pages, create };
  }, [access]);

  const rows = useMemo<ResultRow[]>(() => {
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
        out.push({ id: `pr-${p.id}`, group: "Products", label: p.name, meta: p.status?.toLowerCase(), href: productEditHref(p.id), icon: Shirt });
      }
    }

    const toRow = (e: Entry, group: string): ResultRow => ({ id: e.id, group, label: e.label, meta: e.hint, href: e.href, icon: e.icon });
    if (!q) {
      // Empty query: lead with creating, then a short list of destinations.
      for (const e of entries.create) out.push(toRow(e, "Create"));
      for (const e of entries.pages.filter((p) => p.group === "Pages").slice(0, 8)) out.push(toRow(e, "Jump to"));
      return out;
    }
    // Typed query: records first, then pages, reports, settings, then create actions.
    for (const group of ["Pages", "Reports", "Settings"] as const) {
      for (const e of entries.pages.filter((p) => p.group === group && matches(p, q))) out.push(toRow(e, group));
    }
    for (const e of entries.create.filter((c) => matches(c, q))) out.push(toRow(e, "Create"));
    return out;
  }, [query, searching, orders.data, customers.data, products.data, entries]);

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
            <li className="px-4 py-10 text-center text-sm text-ink-500">{loading ? "Searching…" : `Nothing matches “${query.trim()}”.`}</li>
          ) : (
            rows.map((row, i) => {
              const showGroup = row.group !== lastGroup;
              lastGroup = row.group;
              const Icon = row.icon;
              return (
                <li key={`${row.group}-${row.id}`} role="presentation">
                  {showGroup && <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400 first:pt-1">{row.group}</p>}
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
          <span>
            <kbd className="font-sans">?</kbd> shortcuts
          </span>
          <span className="ml-auto">Search by order #, name or phone</span>
        </div>
      </div>
    </div>
  );
}

/** The global Ctrl/⌘+K binding (shortcut registry: "palette.toggle"). Returns the open state so the header can also open
 * it from a button. */
export function useCommandPaletteHotkey() {
  const [open, setOpen] = useState(false);
  useShortcut("palette.toggle", () => setOpen((o) => !o));
  return [open, setOpen] as const;
}
