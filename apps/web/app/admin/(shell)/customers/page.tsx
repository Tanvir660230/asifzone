"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  XCircle,
  SlidersHorizontal,
  Users,
  UserPlus,
  Flame,
  Star,
  Wallet,
  Moon,
  Eye,
  Phone,
  MessageCircle,
  Send,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  UserX,
} from "lucide-react";
import { BD_ALL_DISTRICTS, normalizeBdPhone, type CustomerTag } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Drawer } from "@/components/ui/drawer";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { Pagination } from "@/components/admin/pagination";
import { StatTile, StatTileSkeleton } from "@/components/admin/stat-tile";
import { EmptyState } from "@/components/admin/empty-state";
import { CustomerDetailPanel } from "@/components/admin/customer-detail-panel";
import { SmsComposer } from "@/components/admin/sms-composer";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as adminCustomersApi from "@/lib/api/admin-customers";
import type { AdminCustomerListParams } from "@/lib/api/admin-customers";
import { formatPrice } from "@/lib/format";
import { ApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";
import { TAG_META, primaryTag } from "@/lib/customer-tags";

const PAGE_SIZE = 20;
const TAG_OPTIONS: CustomerTag[] = [
  "NEW",
  "REPEAT",
  "VIP",
  "HIGH_SPENDER",
  "INACTIVE",
  "SUSPICIOUS",
  "COD_RISK",
  "BLOCKED",
];

type QuickFilter = "noOrders" | "dhaka" | "gazipur" | "last30" | "last90" | null;

const QUICK_FILTERS: Array<{ id: Exclude<QuickFilter, null>; label: string }> = [
  { id: "noOrders", label: "No Orders" },
  { id: "dhaka", label: "Dhaka" },
  { id: "gazipur", label: "Gazipur" },
  { id: "last30", label: "Last 30 Days" },
  { id: "last90", label: "Last 90 Days" },
];

function quickFilterParams(filter: QuickFilter): Partial<AdminCustomerListParams> {
  switch (filter) {
    case "noOrders":
      return { noOrders: "true" };
    case "dhaka":
      return { district: "Dhaka" };
    case "gazipur":
      return { district: "Gazipur" };
    case "last30":
      return { lastOrderDays: 30 };
    case "last90":
      return { lastOrderDays: 90 };
    default:
      return {};
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

function waLink(phone: string): string {
  const local = normalizeBdPhone(phone);
  return `https://wa.me/880${local.slice(1)}`;
}

function CustomerCardSkeleton({ first = false }: { first?: boolean }) {
  return (
    <div className={cn("animate-pulse border-t border-ink-100 p-3.5", first && "border-t-0")}>
      <div className="h-4 w-32 rounded bg-ink-100" />
      <div className="mt-3 h-3 w-40 rounded bg-ink-50" />
      <div className="mt-3 h-4 w-full rounded bg-ink-50" />
    </div>
  );
}

type SortColumn = NonNullable<AdminCustomerListParams["sortBy"]>;

function SortableHeader({
  column,
  sortBy,
  sortDir,
  onSort,
  children,
}: {
  column: SortColumn;
  sortBy: AdminCustomerListParams["sortBy"];
  sortDir: "asc" | "desc";
  onSort: (column: SortColumn) => void;
  children: ReactNode;
}) {
  const active = sortBy === column;
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      onClick={() => onSort(column)}
      className={cn(
        "flex items-center gap-1 whitespace-nowrap font-medium uppercase tracking-wide transition-colors",
        active ? "text-ink-900" : "text-ink-500 hover:text-ink-700",
      )}
    >
      {children}
      <Icon size={12} className={active ? "text-ink-900" : "text-ink-300"} />
    </button>
  );
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<CustomerTag | "">("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [drawer, setDrawer] = useState<{ id: string; focusSms?: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSmsOpen, setBulkSmsOpen] = useState(false);
  const [bulkSmsBody, setBulkSmsBody] = useState("");

  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [district, setDistrict] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [minOrders, setMinOrders] = useState("");

  const [sortBy, setSortBy] = useState<AdminCustomerListParams["sortBy"]>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(column: SortColumn) {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  }

  const debouncedSearch = useDebouncedValue(search, 350);

  const filterParams: AdminCustomerListParams = {
    tag: tag || undefined,
    ...quickFilterParams(quickFilter),
    district: district || undefined,
    minSpend: minSpend ? Number(minSpend) : undefined,
    minOrders: minOrders ? Number(minOrders) : undefined,
    sortBy,
    sortDir: sortBy ? sortDir : undefined,
  };
  const activeMoreFiltersCount = [district, minSpend, minOrders].filter(Boolean).length;
  const hasActiveFilters = Boolean(debouncedSearch || tag || quickFilter || activeMoreFiltersCount > 0);

  function clearAllFilters() {
    setSearch("");
    setTag("");
    setQuickFilter(null);
    setDistrict("");
    setMinSpend("");
    setMinOrders("");
    setPage(1);
  }

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-customers", { page, pageSize, search: debouncedSearch, filterParams }],
    queryFn: () =>
      adminCustomersApi.listCustomers({ page, pageSize, search: debouncedSearch || undefined, ...filterParams }),
    placeholderData: (prev) => prev,
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-customer-stats"],
    queryFn: adminCustomersApi.getCustomerStats,
  });

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));

  function selectQuickFilter(filter: Exclude<QuickFilter, null>) {
    setQuickFilter((prev) => (prev === filter ? null : filter));
    setPage(1);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((c) => c.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const bulkSmsMutation = useMutation({
    mutationFn: () => adminCustomersApi.sendBulkSms(Array.from(selected), bulkSmsBody),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-customer-stats"] });
      if (result.failed === 0) {
        toast.success(`Sent to ${result.sent} customer(s)${result.skipped ? `, ${result.skipped} skipped (no phone)` : ""}`);
      } else {
        toast.error(`${result.sent} sent, ${result.failed} failed${result.skipped ? `, ${result.skipped} skipped` : ""}`);
      }
      setBulkSmsOpen(false);
      setBulkSmsBody("");
      setSelected(new Set());
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Bulk SMS failed"),
  });

  // Shared between the desktop table row and the mobile card (below) so the two views can't drift —
  // same reasoning as the Orders admin page's renderStatusCell/renderRowActions split.
  function renderTagBadge(customer: (typeof items)[number]) {
    const tone = primaryTag(customer.tags);
    const toneMeta = tone ? TAG_META[tone] : null;
    return toneMeta ? (
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", toneMeta.className)}>
        <toneMeta.icon size={11} /> {toneMeta.label}
      </span>
    ) : (
      <span className="text-xs text-ink-400">—</span>
    );
  }

  function renderRowActions(customer: (typeof items)[number]) {
    return (
      <>
        <button
          onClick={() => setDrawer({ id: customer.id })}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
          aria-label="View customer"
          title="View customer"
        >
          <Eye size={16} />
        </button>
        {customer.phone && (
          <>
            <button
              onClick={() => setDrawer({ id: customer.id, focusSms: true })}
              className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-info-600")}
              aria-label="Send SMS"
              title="Send SMS"
            >
              <Send size={16} />
            </button>
            <a
              href={waLink(customer.phone)}
              target="_blank"
              rel="noreferrer"
              className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-success-600")}
              aria-label="WhatsApp"
              title="WhatsApp"
            >
              <MessageCircle size={16} />
            </a>
            <a
              href={`tel:${customer.phone}`}
              className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
              aria-label="Call"
              title="Call"
            >
              <Phone size={16} />
            </a>
          </>
        )}
      </>
    );
  }

  return (
    <div>
      <PageHeader title="Customers" description="Accounts registered on the storefront, with orders, spend, and marketing tools." />

      <div className={cn("mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6")}>
        {stats ? (
          <>
            <StatTile label="Total customers" value={stats.totalCustomers.toLocaleString()} icon={<Users size={18} />} />
            <StatTile label="New this month" value={stats.newThisMonth.toLocaleString()} icon={<UserPlus size={18} />} />
            <StatTile label="Repeat customers" value={stats.repeatCustomers.toLocaleString()} icon={<Flame size={18} />} />
            <StatTile label="Lifetime revenue" value={formatPrice(stats.lifetimeRevenue)} icon={<Wallet size={18} />} tone="accent" />
            <StatTile label="VIP customers" value={stats.vipCustomers.toLocaleString()} icon={<Star size={18} />} tone="accent" />
            <StatTile
              label="Inactive customers"
              value={stats.inactive30.toLocaleString()}
              icon={<Moon size={18} />}
              tone={stats.inactive30 > 0 ? "warning" : "default"}
            />
          </>
        ) : (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        )}
      </div>

      <div className="sticky top-14 z-10 -mx-4 space-y-3.5 border-b border-ink-100 bg-cream-50/95 px-4 pb-4 pt-3 backdrop-blur-sm sm:-mx-8 sm:px-8">
        <div className="space-y-3 rounded-xl border border-ink-100 bg-cream-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-ink-400">Tag</span>
            <button
              onClick={() => {
                setTag("");
                setPage(1);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-smooth",
                !tag
                  ? "border-ink-900 bg-ink-900 text-cream-50"
                  : "border-ink-200 text-ink-500 hover:border-ink-400 hover:bg-ink-50",
              )}
            >
              All
            </button>
            {TAG_OPTIONS.map((t) => {
              const meta = TAG_META[t];
              const Icon = meta.icon;
              return (
                <button
                  key={t}
                  onClick={() => {
                    setTag((prev) => (prev === t ? "" : t));
                    setPage(1);
                  }}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-smooth",
                    meta.className,
                    tag === t ? "border-ink-900 ring-2 ring-ink-900/70" : "border-transparent opacity-55 hover:opacity-100",
                  )}
                >
                  <Icon size={11} /> {meta.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-ink-400">Quick</span>
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => selectQuickFilter(f.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-smooth",
                  quickFilter === f.id
                    ? "border-ink-900 bg-ink-900 text-cream-50"
                    : "border-ink-200 text-ink-600 hover:border-ink-400 hover:bg-ink-50",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-100 bg-cream-50 px-3.5 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-72">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input
                placeholder="Search name, phone, email, order #…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9 pr-8"
              />
              {search && (
                <button
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-300 transition-colors hover:text-ink-600"
                  aria-label="Clear search"
                >
                  <XCircle size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowMoreFilters((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ease-smooth",
                showMoreFilters || activeMoreFiltersCount > 0
                  ? "border-ink-900 bg-ink-900 text-cream-50"
                  : "border-ink-200 text-ink-600 hover:border-ink-400 hover:bg-ink-50",
              )}
            >
              <SlidersHorizontal size={14} />
              More filters
              {activeMoreFiltersCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cream-50 text-[10px] font-semibold text-ink-900">
                  {activeMoreFiltersCount}
                </span>
              )}
            </button>
          </div>
          <PageSizeSelect
            value={pageSize}
            onChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </div>

        {showMoreFilters && (
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-ink-100 bg-cream-50 p-4 shadow-sm sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">District</label>
              <Select
                value={district}
                onChange={(e) => {
                  setDistrict(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Any</option>
                {BD_ALL_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Min. total spend</label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 5000"
                value={minSpend}
                onChange={(e) => {
                  setMinSpend(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Min. orders</label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 2"
                value={minOrders}
                onChange={(e) => {
                  setMinOrders(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            {activeMoreFiltersCount > 0 && (
              <div className="flex items-end sm:col-span-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDistrict("");
                    setMinSpend("");
                    setMinOrders("");
                    setPage(1);
                  }}
                >
                  <XCircle size={14} /> Clear filters
                </Button>
              </div>
            )}
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-sm shadow-float animate-fade-in">
            <span className="flex items-center gap-1.5 font-medium text-ink-800">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink-900 px-1.5 text-xs font-semibold text-cream-50">
                {selected.size}
              </span>
              selected
            </span>
            <Button variant="outline" size="sm" onClick={() => setBulkSmsOpen(true)}>
              <Send size={14} /> Send SMS
            </Button>
            <button
              onClick={() => setSelected(new Set())}
              className={cn(ICON_BUTTON_HIT, "ml-auto text-ink-400 hover:text-ink-700")}
              aria-label="Clear selection"
            >
              <XCircle size={16} />
            </button>
          </div>
        )}
      </div>

      {/* No bounded inner scroll box here — nesting a second vertical-scroll region inside the
          already-scrolling page made the mouse wheel scroll this small box first before the page
          would move, which read as broken/janky (see the same fix on the Orders page).
          sm and up: the table below. Below sm: a card list (below that). */}
      <div className="mt-4 hidden overflow-hidden rounded-xl border border-ink-100 bg-cream-50 shadow-sm sm:block">
        <HScrollShadow className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th className="sticky left-0 z-20 bg-ink-50 px-4 py-3">
                  <SortableHeader column="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                    Customer
                  </SortableHeader>
                </th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">
                  <div className="flex justify-end">
                    <SortableHeader column="totalOrders" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                      Orders
                    </SortableHeader>
                  </div>
                </th>
                <th className="px-4 py-3">
                  <div className="flex justify-end">
                    <SortableHeader column="totalSpent" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                      Spent
                    </SortableHeader>
                  </div>
                </th>
                <th className="px-4 py-3">
                  <SortableHeader column="lastOrderAt" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                    Last Order
                  </SortableHeader>
                </th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 sm:table-cell">Last SMS</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton rows={6} cols={10} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-0">
                    {hasActiveFilters ? (
                      <EmptyState
                        icon={UserX}
                        title="No customers match your filters"
                        description="Try adjusting or clearing your search and filters."
                        action={
                          <button onClick={clearAllFilters} className="text-sm text-info-600 hover:underline">
                            Clear all filters
                          </button>
                        }
                      />
                    ) : (
                      <EmptyState icon={Users} title="No customers yet" description="Accounts will show up here as people register or check out." />
                    )}
                  </td>
                </tr>
              )}
              {items.map((customer) => {
                return (
                  <tr key={customer.id} className="group border-t border-ink-100 transition-colors duration-150 ease-smooth hover:bg-ink-50/60">
                    <td className="px-4 py-3.5">
                      <Checkbox
                        checked={selected.has(customer.id)}
                        onChange={() => toggleOne(customer.id)}
                        aria-label={`Select ${customer.name}`}
                      />
                    </td>
                    <td className="sticky left-0 z-[1] bg-cream-50 px-4 py-3.5 group-hover:bg-ink-50">
                      <button
                        onClick={() => setDrawer({ id: customer.id })}
                        className="flex items-center gap-3 text-left"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                          {initials(customer.name)}
                        </span>
                        <span className="font-medium text-ink-900 hover:text-info-600 hover:underline">{customer.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-ink-500">{customer.phone ?? "—"}</td>
                    <td className="px-4 py-3.5 text-ink-500">{customer.email ?? "—"}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-700">{customer.totalOrders}</td>
                    <td className="px-4 py-3.5 text-right font-medium tabular-nums text-ink-900">{formatPrice(customer.totalSpent)}</td>
                    <td className="px-4 py-3.5 text-ink-500">
                      {customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3.5">{renderTagBadge(customer)}</td>
                    <td className="hidden px-4 py-3.5 text-ink-500 sm:table-cell">
                      {customer.lastSmsSentAt ? new Date(customer.lastSmsSentAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex justify-end gap-3">{renderRowActions(customer)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HScrollShadow>
      </div>

      {/* Below sm: one continuous bordered list instead of the table above — same card-list pattern
          (and same reasoning: the sticky filter zone scrolls over it, so no floating-card shadow
          gets awkwardly clipped mid-scroll) as the Orders admin page. */}
      <div className="mt-4 overflow-hidden rounded-xl border border-ink-100 bg-cream-50 shadow-sm sm:hidden">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <CustomerCardSkeleton key={i} first={i === 0} />)}
        {!isLoading && items.length === 0 && (
          hasActiveFilters ? (
            <EmptyState
              icon={UserX}
              title="No customers match your filters"
              description="Try adjusting or clearing your search and filters."
              action={
                <button onClick={clearAllFilters} className="text-sm text-info-600 hover:underline">
                  Clear all filters
                </button>
              }
            />
          ) : (
            <EmptyState icon={Users} title="No customers yet" description="Accounts will show up here as people register or check out." />
          )
        )}
        {!isLoading && items.length > 0 && (
          <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2 text-xs text-ink-500">
            <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            Select all on this page
          </div>
        )}
        {items.map((customer) => (
          <div key={customer.id} className="border-t border-ink-100 p-3.5 first:border-t-0">
            <div className="flex items-start gap-2.5">
              <Checkbox
                checked={selected.has(customer.id)}
                onChange={() => toggleOne(customer.id)}
                className="mt-1"
                aria-label={`Select ${customer.name}`}
              />
              <button onClick={() => setDrawer({ id: customer.id })} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                  {initials(customer.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">{customer.name}</span>
                  <span className="block truncate text-xs text-ink-400">{customer.phone ?? customer.email ?? "—"}</span>
                </span>
              </button>
              <span className="shrink-0 text-right font-medium tabular-nums text-ink-900">{formatPrice(customer.totalSpent)}</span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2.5 text-xs text-ink-500">
              <span>
                {customer.totalOrders} order{customer.totalOrders === 1 ? "" : "s"} ·{" "}
                {customer.lastOrderAt ? `last ${new Date(customer.lastOrderAt).toLocaleDateString()}` : "no orders yet"}
              </span>
              {renderTagBadge(customer)}
            </div>

            <div className="mt-2.5 flex items-center justify-end gap-3 border-t border-ink-100 pt-2.5">{renderRowActions(customer)}</div>
          </div>
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      <Drawer open={Boolean(drawer)} onClose={() => setDrawer(null)} title="Customer details" widthClassName="max-w-2xl">
        {drawer && (
          <CustomerDetailPanel
            customerId={drawer.id}
            onClose={() => setDrawer(null)}
            variant="drawer"
            focusSms={drawer.focusSms}
          />
        )}
      </Drawer>

      <Modal open={bulkSmsOpen} onClose={() => setBulkSmsOpen(false)} title={`Send SMS to ${selected.size} customer(s)`}>
        <div className="space-y-4">
          <SmsComposer
            value={bulkSmsBody}
            onChange={setBulkSmsBody}
            previewContext={(() => {
              const first = items.find((c) => selected.has(c.id));
              return first
                ? { name: first.name, phone: first.phone, totalSpent: first.totalSpent, lastOrderAt: first.lastOrderAt }
                : undefined;
            })()}
            previewLabel="first selected customer — each recipient gets their own name/spend filled in"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setBulkSmsOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!bulkSmsBody.trim() || bulkSmsMutation.isPending}
              onClick={() => bulkSmsMutation.mutate()}
            >
              <Send size={14} /> Send to {selected.size}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
