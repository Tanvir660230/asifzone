"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Trash2,
  RotateCcw,
  Eye,
  Download,
  XCircle,
  ArchiveX,
  ShoppingBag,
  Truck,
  SlidersHorizontal,
  ExternalLink,
  Printer,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Plus,
  ChevronDown,
  SearchX,
  Package,
} from "lucide-react";
import type {
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  BdDivision,
  OrderListItemSummary,
  AdminOrderListItem,
} from "@clothing-brand/shared";
import { BD_DIVISIONS, BD_DISTRICTS_BY_DIVISION, COURIER_DELIVERY_STATUSES } from "@clothing-brand/shared";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Modal } from "@/components/ui/modal";
import { Drawer } from "@/components/ui/drawer";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { Pagination } from "@/components/admin/pagination";
import { EmptyState } from "@/components/admin/empty-state";
import { OrderDetailPanel } from "@/components/admin/order-detail-panel";
import { useCurrentAdmin } from "@/hooks/use-current-admin";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import type { BulkCourierBookResult, AdminOrderListParams } from "@/lib/api/admin-orders";
import {
  formatPrice,
  orderStatusBadgeClass,
  courierStatusBadgeClass,
  courierStatusLabel,
  courierStatusDescription,
} from "@/lib/format";
import { resolveImageUrl } from "@/lib/image-url";
import { ApiError } from "@/lib/api-client";
import { cn, ICON_BUTTON_HIT } from "@/lib/utils";

const PAGE_SIZE = 20;
const STATUS_OPTIONS: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "CANCELLED",
  "RETURNED",
  "REFUNDED",
];

const STATUS_BORDER_COLORS: Record<OrderStatus, string> = {
  PENDING: "border-l-warning-400",
  CONFIRMED: "border-l-info-400",
  PROCESSING: "border-l-info-400",
  PACKED: "border-l-info-400",
  SHIPPED: "border-l-info-400",
  DELIVERED: "border-l-success-400",
  PARTIALLY_DELIVERED: "border-l-warning-400",
  CANCELLED: "border-l-danger-400",
  RETURNED: "border-l-warning-400",
  REFUNDED: "border-l-ink-400",
};

const ALL_DISTRICTS = Array.from(new Set(Object.values(BD_DISTRICTS_BY_DIVISION).flat())).sort();

type QuickFilter = "unpaid" | "cod" | "cancelledReturned" | "followUpDue" | null;

const QUICK_FILTERS: Array<{ id: Exclude<QuickFilter, null>; label: string }> = [
  { id: "unpaid", label: "Unpaid" },
  { id: "cod", label: "COD" },
  { id: "cancelledReturned", label: "Cancelled / Returned" },
  { id: "followUpDue", label: "Follow-up due" },
];

function quickFilterParams(filter: QuickFilter, status: OrderStatus | "") {
  switch (filter) {
    case "unpaid":
      return { paymentStatus: "UNPAID" as PaymentStatus };
    case "cod":
      return { paymentMethod: "COD" as PaymentMethod };
    case "cancelledReturned":
      return { statusIn: ["CANCELLED", "RETURNED"] as OrderStatus[] };
    case "followUpDue":
      return { followUpDue: "true" as const };
    default:
      return { status: status || undefined };
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

type SortColumn = NonNullable<AdminOrderListParams["sortBy"]>;

function SortableHeader({
  column,
  sortBy,
  sortDir,
  onSort,
  children,
}: {
  column: SortColumn;
  sortBy: AdminOrderListParams["sortBy"];
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

/** "Which product is this order for" at a glance — the first line item's thumbnail/name/variant,
 * plus a "+N more" count when the order has other items. Clicking goes straight to the live
 * storefront product page (the actual product, not its admin edit form) in a new tab — to see the
 * order itself, click the order number or the row's Eye icon instead. Plain (non-clickable) text
 * when the underlying variant/product no longer exists. */
function ProductCell({ summary }: { summary: OrderListItemSummary }) {
  if (!summary.firstItem) return <span className="text-xs text-ink-400">—</span>;

  const { name, size, color, imageUrl, productSlug } = summary.firstItem;
  const extra = summary.totalItems - 1;
  const variant = [size, color].filter(Boolean).join(" / ");
  const subtitle = extra > 0 ? `${variant ? `${variant} · ` : ""}+${extra} more item${extra > 1 ? "s" : ""}` : variant;

  const thumb = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-ink-100 bg-ink-50">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolveImageUrl(imageUrl)} alt="" className="h-full w-full object-cover" />
      ) : (
        <Package size={14} className="text-ink-300" />
      )}
    </span>
  );
  const label = (
    <div className="min-w-0">
      <div className="max-w-[170px] truncate text-ink-800 transition-colors group-hover/product:text-info-600 group-hover/product:underline">
        {name}
      </div>
      {subtitle && <div className="max-w-[170px] truncate text-xs text-ink-400">{subtitle}</div>}
    </div>
  );

  if (!productSlug) {
    return (
      <div className="flex items-center gap-2.5 opacity-70" title={`${name} — product no longer available`}>
        {thumb}
        {label}
      </div>
    );
  }

  return (
    <Link href={`/product/${productSlug}`} target="_blank" className="group/product flex items-center gap-2.5" title={`View ${name}`}>
      {thumb}
      {label}
    </Link>
  );
}

/** Loading placeholder for the mobile order list — TableSkeleton renders <tr>/<td> and can't back
 * a div-based list, so this is a small standalone equivalent. Border-t/first:border-t-0 (not its
 * own rounded/shadowed box) to match the real rows' styling inside their shared container. */
function OrderCardSkeleton({ first = false }: { first?: boolean }) {
  return (
    <div className={cn("animate-pulse border-t border-ink-100 p-3.5", first && "border-t-0")}>
      <div className="h-4 w-24 rounded bg-ink-100" />
      <div className="mt-3 h-9 w-full rounded bg-ink-50" />
      <div className="mt-3 h-4 w-40 rounded bg-ink-100" />
    </div>
  );
}

export default function OrdersPage() {
  const [tab, setTab] = useState<"active" | "trash">("active");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatusValue, setBulkStatusValue] = useState<OrderStatus | "">("");
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);

  // Advanced filters — combinable with each other and with the quick filters/status dropdown above,
  // so an admin can e.g. isolate "not yet booked, Dhaka division, placed this week" for a courier run.
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [courierBooked, setCourierBooked] = useState<"" | "true" | "false">("");
  const [courierStatusFilter, setCourierStatusFilter] = useState("");
  const [division, setDivision] = useState<BdDivision | "">("");
  const [district, setDistrict] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [bulkCourierResult, setBulkCourierResult] = useState<BulkCourierBookResult | null>(null);

  // Column-header sort — undefined sortBy means the default (newest first) from the API.
  const [sortBy, setSortBy] = useState<AdminOrderListParams["sortBy"]>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(column: NonNullable<AdminOrderListParams["sortBy"]>) {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  }

  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { data: currentAdmin } = useCurrentAdmin();
  const isOwner = currentAdmin?.admin.role === "OWNER";
  const debouncedSearch = useDebouncedValue(search, 350);

  const filterParams = {
    ...quickFilterParams(quickFilter, status),
    courierBooked: courierBooked || undefined,
    courierStatus: courierStatusFilter || undefined,
    shippingDivision: division || undefined,
    shippingDistrict: district || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sortBy,
    sortDir: sortBy ? sortDir : undefined,
  };
  const activeMoreFiltersCount = [courierBooked, courierStatusFilter, division, district, dateFrom, dateTo].filter(
    Boolean,
  ).length;
  const hasActiveFilters = Boolean(debouncedSearch || quickFilter || status || activeMoreFiltersCount > 0);

  function clearAllFilters() {
    setSearch("");
    setStatus("");
    setQuickFilter(null);
    setCourierBooked("");
    setCourierStatusFilter("");
    setDivision("");
    setDistrict("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  // The row set on screen changes under the selection whenever the query params change — without
  // this, the bulk-action bar can keep showing "N selected" for rows that have scrolled out of view
  // (a different page/filter), and bulk actions would silently apply to that stale, invisible set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSelected(new Set()), [
    page,
    pageSize,
    debouncedSearch,
    tab,
    quickFilter,
    status,
    courierBooked,
    courierStatusFilter,
    division,
    district,
    dateFrom,
    dateTo,
    sortBy,
    sortDir,
  ]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orders", { page, pageSize, search: debouncedSearch, tab, filterParams }],
    queryFn: () =>
      adminOrdersApi.listOrders({
        page,
        pageSize,
        search: debouncedSearch || undefined,
        deleted: tab === "trash",
        ...filterParams,
      }),
    placeholderData: (prev) => prev,
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-order-stats"],
    queryFn: adminOrdersApi.getOrderStats,
  });
  const statusTotal = stats && Object.values(stats.statusCounts).reduce((sum, n) => sum + n, 0);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    queryClient.invalidateQueries({ queryKey: ["admin-order-stats"] });
    setSelected(new Set());
  }

  const deleteMutation = useMutation({
    mutationFn: adminOrdersApi.deleteOrder,
    onSuccess: () => {
      invalidate();
      toast.success("Order moved to Trash");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to delete order"),
  });

  const restoreMutation = useMutation({
    mutationFn: adminOrdersApi.restoreOrder,
    onSuccess: () => {
      invalidate();
      toast.success("Order restored");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to restore order"),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: adminOrdersApi.permanentlyDeleteOrder,
    onSuccess: () => {
      invalidate();
      toast.success("Order permanently deleted");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to permanently delete order"),
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status: s }: { ids: string[]; status: OrderStatus }) =>
      adminOrdersApi.bulkUpdateOrderStatus(ids, s),
    // The backend applies these one order at a time and stops at the first failure (e.g. one order
    // in the batch got trashed by someone else first) — by then some orders already committed, so
    // refetch on failure too (onSettled, not onSuccess) instead of leaving the table showing
    // pre-update data alongside a stale "N selected" bar.
    onSettled: invalidate,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status: s }: { id: string; status: OrderStatus }) => adminOrdersApi.updateOrderStatus(id, s),
    onSuccess: () => {
      invalidate();
      toast.success("Order status updated");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Failed to update order status"),
  });

  const bulkBookCourierMutation = useMutation({
    mutationFn: adminOrdersApi.bulkBookCourier,
    onSuccess: (result) => {
      invalidate();
      setBulkCourierResult(result);
      if (result.failed.length === 0) {
        toast.success(`${result.booked.length} order(s) booked with Steadfast`);
      } else if (result.booked.length === 0) {
        toast.error(`Booking failed for all ${result.failed.length} order(s)`);
      } else {
        toast.success(`${result.booked.length} booked, ${result.failed.length} failed — see details`);
      }
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Bulk courier booking failed"),
  });

  // Same reasoning as bulkStatusMutation above — refetch even on partial failure.
  const bulkDeleteMutation = useMutation({ mutationFn: adminOrdersApi.bulkDeleteOrders, onSettled: invalidate });
  const bulkPermanentDeleteMutation = useMutation({
    mutationFn: adminOrdersApi.bulkPermanentlyDeleteOrders,
    onSettled: invalidate,
  });

  async function handleDelete(orderNumber: string, id: string) {
    if (!(await confirm(`Move order ${orderNumber} to Trash? Stock will be restored — you can undo this from the Trash tab.`)))
      return;
    deleteMutation.mutate(id);
  }

  async function handleRestore(orderNumber: string, id: string) {
    if (!(await confirm(`Restore order ${orderNumber}?`))) return;
    restoreMutation.mutate(id);
  }

  async function handlePermanentDelete(orderNumber: string, id: string) {
    if (
      !(await confirm(
        `Permanently delete order ${orderNumber}? This removes it and its line items/history forever — it cannot be undone.`,
        { confirmLabel: "Delete forever", requireText: orderNumber },
      ))
    )
      return;
    try {
      await permanentDeleteMutation.mutateAsync(id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to permanently delete order");
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (!(await confirm(`Move ${ids.length} order(s) to Trash?`))) return;
    try {
      await bulkDeleteMutation.mutateAsync(ids);
      toast.success(`${ids.length} order(s) moved to Trash`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk delete failed");
    }
  }

  async function handleStatusChange(orderNumber: string, id: string, from: OrderStatus, to: OrderStatus) {
    if (to === from) return;
    if (!(await confirm(`Change order ${orderNumber} status from ${from} to ${to}?`, "Change status"))) return;
    statusMutation.mutate({ id, status: to });
  }

  async function handleBulkStatus() {
    const ids = Array.from(selected);
    if (!bulkStatusValue) return;
    try {
      await bulkStatusMutation.mutateAsync({ ids, status: bulkStatusValue });
      toast.success(`${ids.length} order(s) set to ${bulkStatusValue}`);
      setBulkStatusValue("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk status update failed");
    }
  }

  async function handleBulkBookCourier() {
    const ids = Array.from(selected);
    if (
      !(await confirm(
        `Book ${ids.length} order(s) with Steadfast? Orders already booked or in Trash are skipped automatically.`,
        "Book",
      ))
    )
      return;
    bulkBookCourierMutation.mutate(ids);
  }

  function handlePrintLabels() {
    sessionStorage.setItem(adminOrdersApi.PRINT_LABEL_ORDER_IDS_KEY, JSON.stringify(Array.from(selected)));
    router.push("/admin/orders/print-labels");
  }

  async function handleBulkRestore() {
    const ids = Array.from(selected);
    if (!(await confirm(`Restore ${ids.length} order(s)?`))) return;
    await Promise.all(ids.map((id) => restoreMutation.mutateAsync(id)));
    invalidate();
  }

  async function handleBulkPermanentDelete() {
    const ids = Array.from(selected);
    if (
      !(await confirm(
        `Permanently delete ${ids.length} order(s)? This removes them and their line items/history forever — it cannot be undone.`,
        { confirmLabel: "Delete forever", requireText: "DELETE" },
      ))
    )
      return;
    try {
      await bulkPermanentDeleteMutation.mutateAsync(ids);
      toast.success(`${ids.length} order(s) permanently deleted`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bulk permanent delete failed");
    }
  }

  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));

  // Drawer prev/next — relative to whatever's on the currently-loaded page/filter, not a
  // cross-page fetch. If the open order isn't in `items` at all (e.g. a filter change dropped it),
  // drawerIndex is -1 and both directions disable — the drawer itself keeps working via its own
  // independent order-by-id query, it just can't navigate relative to a list it's no longer part of.
  const drawerIndex = drawerOrderId ? items.findIndex((o) => o.id === drawerOrderId) : -1;
  const hasPrevOrder = drawerIndex > 0;
  const hasNextOrder = drawerIndex !== -1 && drawerIndex < items.length - 1;
  function goToDrawerOffset(offset: number) {
    if (drawerIndex === -1) return;
    const next = items[drawerIndex + offset];
    if (next) setDrawerOrderId(next.id);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((o) => o.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectQuickFilter(filter: Exclude<QuickFilter, null>) {
    setQuickFilter((prev) => (prev === filter ? null : filter));
    setStatus("");
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const csvUrl = useMemo(
    () =>
      adminOrdersApi.downloadOrdersCsvUrl({
        search: debouncedSearch || undefined,
        deleted: tab === "trash",
        ...filterParams,
      }),
    // filterParams is a fresh object every render, so depend on its actual filter values instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      debouncedSearch,
      tab,
      quickFilter,
      status,
      courierBooked,
      courierStatusFilter,
      division,
      district,
      dateFrom,
      dateTo,
      sortBy,
      sortDir,
    ],
  );

  // Shared between the desktop table row and the mobile card (below) so a future behavior change
  // (e.g. a new bulk action, a new status color) can't update one view and silently miss the other
  // — only the surrounding layout differs between the two.
  function renderStatusCell(order: AdminOrderListItem) {
    if (order.deletedAt) {
      return <Badge className={orderStatusBadgeClass(order.status)}>{order.status}</Badge>;
    }
    return (
      <div className="relative inline-block">
        <Select
          value={order.status}
          disabled={statusMutation.isPending}
          onChange={(e) => handleStatusChange(order.orderNumber, order.id, order.status, e.target.value as OrderStatus)}
          className={cn(
            "h-auto w-auto appearance-none rounded-full border-0 py-1 pl-2.5 pr-6 text-xs font-semibold",
            orderStatusBadgeClass(order.status),
          )}
          aria-label={`Change status for ${order.orderNumber}`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-60" />
      </div>
    );
  }

  function renderCourierCell(order: AdminOrderListItem) {
    if (!order.courierConsignmentId) {
      return <span className="text-xs text-ink-400">Not booked</span>;
    }
    return (
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            courierStatusBadgeClass(order.courierStatus ?? ""),
          )}
          title={
            order.courierStatus ? courierStatusDescription(order.courierStatus) : "Booked with Steadfast — status not yet reported"
          }
        >
          {order.courierStatus ? courierStatusLabel(order.courierStatus) : "Booked"}
        </span>
        {order.courierTrackingLink && (
          <a
            href={order.courierTrackingLink}
            target="_blank"
            rel="noreferrer"
            className="text-ink-400 hover:text-info-600"
            aria-label="Track parcel"
            title="Track parcel"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    );
  }

  function renderRowActions(order: AdminOrderListItem) {
    return (
      <>
        <button
          onClick={() => setDrawerOrderId(order.id)}
          className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
          aria-label="View order"
          title="View order"
        >
          <Eye size={16} />
        </button>
        {isOwner &&
          (order.deletedAt ? (
            <>
              <button
                onClick={() => handleRestore(order.orderNumber, order.id)}
                className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-ink-900")}
                aria-label="Restore"
                title="Restore"
              >
                <RotateCcw size={16} />
              </button>
              <button
                onClick={() => handlePermanentDelete(order.orderNumber, order.id)}
                className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")}
                aria-label="Delete permanently"
                title="Delete permanently"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : (
            <button
              onClick={() => handleDelete(order.orderNumber, order.id)}
              className={cn(ICON_BUTTON_HIT, "text-ink-500 hover:text-danger-600")}
              aria-label="Delete"
              title="Move to Trash"
            >
              <Trash2 size={16} />
            </button>
          ))}
      </>
    );
  }

  function renderEmptyState() {
    if (tab === "trash") {
      return <EmptyState icon={ArchiveX} title="Trash is empty" description="Deleted orders will appear here." />;
    }
    if (hasActiveFilters) {
      return (
        <EmptyState
          icon={SearchX}
          title="No orders match your filters"
          description="Try adjusting or clearing your search and filters."
          action={
            <Button variant="outline" size="sm" onClick={clearAllFilters}>
              Clear all filters
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Orders will show up here as customers check out."
        action={
          <Link href="/admin/orders/new">
            <Button size="sm">
              <Plus size={14} /> Create order
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Manage, fulfill, and track customer orders."
        action={
          <div className="flex items-center gap-2">
            <a href={csvUrl}>
              <Button variant="outline">
                <Download size={16} /> Export CSV
              </Button>
            </a>
            <Link href="/admin/orders/new">
              <Button variant="brass">
                <Plus size={16} /> Create Order
              </Button>
            </Link>
          </div>
        }
      />

      {/* Sticky control zone: anchored just below the app shell's h-14 top bar, so filters and bulk
          actions stay reachable while scrolling. The table below scrolls with the page (no bounded
          inner scroll box) — nesting a second vertical-scroll region inside an already-scrolling
          page made the mouse wheel scroll the tiny table box first before the page would move,
          which read as broken/janky. Horizontal scroll (for narrow viewports) is unaffected. */}
      <div className="sticky top-14 z-30 -mx-4 space-y-3 border-b border-ink-100 bg-cream-50/95 px-4 pb-3 pt-2.5 backdrop-blur-sm sm:-mx-8 sm:px-8">
        {isOwner && (
          <div className="flex items-center gap-1">
            {(["active", "trash"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setPage(1);
                  setSelected(new Set());
                }}
                className={cn(
                  "border-b-2 px-3 py-1.5 text-sm font-medium capitalize transition-colors duration-150 ease-smooth",
                  tab === t ? "border-ink-900 text-ink-900" : "border-transparent text-ink-400 hover:text-ink-600",
                )}
              >
                {t === "trash" ? "Trash" : "Active"}
              </button>
            ))}
          </div>
        )}

        {/* One unified elevated panel for the whole filter zone (status pills / search / advanced
            filters), with internal dividers between sub-sections instead of each stacking its own
            separately-bordered, separately-shadowed box — reads as one clean surface, not a pile
            of boxes. */}
        <div className="overflow-hidden rounded-xl border border-ink-100 bg-cream-50 shadow-sm">
          {tab === "active" && (
            <div className="border-b border-ink-100 px-4 py-2.5">
              {/* A single horizontally-scrollable row, not flex-wrap — 14 pills (All + 9 statuses + 4
                  quick filters) wrapping wastes several rows of height on any viewport, which buried
                  the actual order list below the fold. Same scroll-affordance component as the table. */}
              <HScrollShadow className="overflow-x-auto">
                <div className="flex flex-nowrap items-center gap-1.5">
                  <span className="mr-1 shrink-0 text-xs font-medium uppercase tracking-wide text-ink-400">Status</span>
                  <button
                    onClick={() => {
                      setStatus("");
                      setQuickFilter(null);
                      setPage(1);
                    }}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-smooth lg:px-2.5 lg:py-1",
                      !status
                        ? "border-ink-900 bg-ink-900 text-cream-50"
                        : "border-ink-200 text-ink-500 hover:border-ink-400 hover:bg-ink-50",
                    )}
                  >
                    All
                    {statusTotal !== undefined && (
                      <span
                        className={cn(
                          "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                          !status ? "bg-cream-50/25 text-cream-50" : "bg-ink-900/10 text-ink-600",
                        )}
                      >
                        {statusTotal}
                      </span>
                    )}
                  </button>
                  {STATUS_OPTIONS.map((s) => {
                    const count = stats?.statusCounts[s];
                    const active = status === s;
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          setStatus((prev) => (prev === s ? "" : s));
                          setQuickFilter(null);
                          setPage(1);
                        }}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-smooth lg:px-2.5 lg:py-1",
                          orderStatusBadgeClass(s),
                          active ? "border-ink-900 ring-2 ring-ink-900/70" : "border-transparent opacity-60 hover:opacity-100",
                        )}
                      >
                        {s}
                        {typeof count === "number" && (
                          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink-900/10 px-1 text-[10px] font-semibold tabular-nums">
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <span className="mx-1 h-4 w-px shrink-0 bg-ink-200" aria-hidden />
                  {QUICK_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => selectQuickFilter(f.id)}
                      className={cn(
                        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-smooth lg:px-2.5 lg:py-1",
                        quickFilter === f.id
                          ? "border-ink-900 bg-ink-900 text-cream-50"
                          : "border-ink-200 text-ink-600 hover:border-ink-400 hover:bg-ink-50",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </HScrollShadow>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full sm:w-64 lg:w-56">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <Input
                  placeholder="Search order #, name, phone…"
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
                  "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ease-smooth lg:py-1.5",
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
          <div className="grid grid-cols-1 gap-3 border-t border-ink-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Courier</label>
              <Select
                value={courierBooked}
                onChange={(e) => {
                  setCourierBooked(e.target.value as "" | "true" | "false");
                  setPage(1);
                }}
              >
                <option value="">Any</option>
                <option value="false">Not booked</option>
                <option value="true">Booked</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Delivery status</label>
              <Select
                value={courierStatusFilter}
                onChange={(e) => {
                  setCourierStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Any</option>
                {COURIER_DELIVERY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {courierStatusLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Division</label>
              <Select
                value={division}
                onChange={(e) => {
                  setDivision(e.target.value as BdDivision | "");
                  setDistrict("");
                  setPage(1);
                }}
              >
                <option value="">Any</option>
                {BD_DIVISIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">District</label>
              <SearchableSelect
                value={district}
                onChange={(v) => {
                  setDistrict(v);
                  setPage(1);
                }}
                options={division ? BD_DISTRICTS_BY_DIVISION[division] : ALL_DISTRICTS}
                placeholder="Any district"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Placed from</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Placed to</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            {activeMoreFiltersCount > 0 && (
              <div className="flex items-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCourierBooked("");
                    setCourierStatusFilter("");
                    setDivision("");
                    setDistrict("");
                    setDateFrom("");
                    setDateTo("");
                    setPage(1);
                  }}
                >
                  <XCircle size={14} /> Clear filters
                </Button>
              </div>
            )}
          </div>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 text-sm shadow-float animate-fade-in">
            <span className="flex items-center gap-1.5 font-medium text-ink-800">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ink-900 px-1.5 text-xs font-semibold text-cream-50">
                {selected.size}
              </span>
              selected
            </span>
            {tab === "active" ? (
              <>
                <div className="flex items-center gap-1.5">
                  <Select
                    className="h-8 w-40"
                    value={bulkStatusValue}
                    onChange={(e) => setBulkStatusValue(e.target.value as OrderStatus | "")}
                  >
                    <option value="">Set status…</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                  <Button variant="outline" size="sm" disabled={!bulkStatusValue} onClick={handleBulkStatus}>
                    Apply
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkBookCourierMutation.isPending}
                  onClick={handleBulkBookCourier}
                >
                  <Truck size={14} /> Book with Steadfast
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrintLabels}>
                  <Printer size={14} /> Print Labels
                </Button>
                {isOwner && (
                  <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                    <Trash2 size={14} /> Move to Trash
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={handleBulkRestore}>
                  <RotateCcw size={14} /> Restore selected
                </Button>
                <Button variant="destructive" size="sm" onClick={handleBulkPermanentDelete}>
                  <Trash2 size={14} /> Delete forever
                </Button>
              </>
            )}
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

      {/* sm and up: the original table, unchanged content. Below sm: a card list (below). */}
      <div className="mt-5 hidden overflow-hidden rounded-xl border border-ink-100 bg-cream-50 shadow sm:block">
        <HScrollShadow className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-100 bg-ink-50/70 text-left text-xs font-semibold uppercase tracking-wider text-ink-500">
            <tr>
              <th className="w-10 px-5 py-3.5">
                <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="sticky left-0 z-20 bg-ink-50/70 px-5 py-3.5">
                <SortableHeader column="orderNumber" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                  Order
                </SortableHeader>
              </th>
              <th className="px-5 py-3.5">Product</th>
              <th className="px-5 py-3.5">
                <SortableHeader column="customerName" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                  Customer
                </SortableHeader>
              </th>
              <th className="px-5 py-3.5">
                <SortableHeader column="paymentStatus" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                  Payment
                </SortableHeader>
              </th>
              <th className="px-5 py-3.5">
                <div className="flex justify-end">
                  <SortableHeader column="total" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                    Total
                  </SortableHeader>
                </div>
              </th>
              <th className="px-5 py-3.5">
                <SortableHeader column="status" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                  Status
                </SortableHeader>
              </th>
              <th className="px-5 py-3.5">Courier</th>
              <th className="hidden px-5 py-3.5 sm:table-cell">
                <SortableHeader column="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort}>
                  Placed
                </SortableHeader>
              </th>
              <th className="px-5 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} cols={10} />}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={10} className="p-0">
                  {renderEmptyState()}
                </td>
              </tr>
            )}
            {items.map((order) => (
              <tr
                key={order.id}
                className={cn(
                  "group border-t border-ink-100 border-l-4 transition-colors duration-150 ease-smooth hover:bg-ink-50/60",
                  STATUS_BORDER_COLORS[order.status],
                )}
              >
                <td className="px-5 py-4">
                  <Checkbox checked={selected.has(order.id)} onChange={() => toggleOne(order.id)} aria-label={`Select ${order.orderNumber}`} />
                </td>
                <td className="sticky left-0 z-[1] bg-cream-50 px-5 py-4 group-hover:bg-ink-50/60">
                  <button
                    onClick={() => setDrawerOrderId(order.id)}
                    className="font-medium text-ink-900 transition-colors hover:text-info-600 hover:underline"
                  >
                    {order.orderNumber}
                  </button>
                </td>
                <td className="px-5 py-4">
                  <ProductCell summary={order.itemsSummary} />
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                      {initials(order.customerName)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate">{order.customerName}</div>
                      <div className="text-xs text-ink-400">{order.customerPhone}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-col items-start gap-1">
                    <Badge className={order.paymentMethod === "COD" ? "bg-ink-100 text-ink-700" : "bg-info-100 text-info-700"}>
                      {order.paymentMethod === "COD" ? "COD" : "Online"}
                    </Badge>
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        order.paymentStatus === "PAID"
                          ? "text-success-600"
                          : order.paymentStatus === "FAILED"
                            ? "text-danger-600"
                            : "text-warning-600",
                      )}
                    >
                      {order.paymentStatus === "PAID" ? "Paid" : order.paymentStatus === "FAILED" ? "Failed" : "Unpaid"}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-4 text-right font-medium tabular-nums text-ink-900">{formatPrice(order.total)}</td>
                <td className="px-5 py-4">{renderStatusCell(order)}</td>
                <td className="px-5 py-4">{renderCourierCell(order)}</td>
                <td className="hidden px-5 py-4 text-ink-500 sm:table-cell">
                  <div>{new Date(order.createdAt).toLocaleDateString()}</div>
                  <div className="text-xs text-ink-400">
                    {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex justify-end gap-3">{renderRowActions(order)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </HScrollShadow>
      </div>

      {/* Below sm: one continuous bordered list instead of the table above — deliberately NOT
          separately-shadowed floating cards. The sticky filter zone above scrolls over this list
          as the page scrolls (by design, so filters stay reachable); a floating card whose own
          rounded top border gets covered by the sticky bar mid-scroll leaves a borderless,
          disconnected-looking fragment behind. One shared container with border-t dividers between
          orders (same structure as the desktop table's rows) scrolls under the sticky bar exactly
          the way the table already does, with nothing looking detached. */}
      <div className="mt-5 overflow-hidden rounded-xl border border-ink-100 bg-cream-50 shadow sm:hidden">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => <OrderCardSkeleton key={i} first={i === 0} />)}
        {!isLoading && items.length === 0 && renderEmptyState()}
        {!isLoading && items.length > 0 && (
          <div className="flex items-center gap-2 border-b border-ink-100 px-3.5 py-2 text-xs text-ink-500">
            <Checkbox checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            Select all on this page
          </div>
        )}
        {items.map((order) => (
          <div
            key={order.id}
            className={cn(
              "border-t border-ink-100 border-l-4 p-3.5 first:border-t-0",
              STATUS_BORDER_COLORS[order.status],
            )}
          >
            <div className="flex items-start gap-2.5">
              <Checkbox
                checked={selected.has(order.id)}
                onChange={() => toggleOne(order.id)}
                className="mt-1"
                aria-label={`Select ${order.orderNumber}`}
              />
              <button onClick={() => setDrawerOrderId(order.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink-900">{order.orderNumber}</span>
                  <span className="font-medium tabular-nums text-ink-900">{formatPrice(order.total)}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-400">
                  {new Date(order.createdAt).toLocaleDateString()} ·{" "}
                  {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </button>
            </div>

            <div className="mt-2.5 border-t border-ink-100 pt-2.5">
              <ProductCell summary={order.itemsSummary} />
            </div>

            <div className="mt-2.5 flex items-center gap-3 border-t border-ink-100 pt-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-700">
                {initials(order.customerName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink-800">{order.customerName}</div>
                <div className="text-xs text-ink-400">{order.customerPhone}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <Badge className={order.paymentMethod === "COD" ? "bg-ink-100 text-ink-700" : "bg-info-100 text-info-700"}>
                  {order.paymentMethod === "COD" ? "COD" : "Online"}
                </Badge>
                <span
                  className={cn(
                    "text-[11px] font-medium",
                    order.paymentStatus === "PAID"
                      ? "text-success-600"
                      : order.paymentStatus === "FAILED"
                        ? "text-danger-600"
                        : "text-warning-600",
                  )}
                >
                  {order.paymentStatus === "PAID" ? "Paid" : order.paymentStatus === "FAILED" ? "Failed" : "Unpaid"}
                </span>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {renderStatusCell(order)}
                {renderCourierCell(order)}
              </div>
              <div className="flex items-center gap-3">{renderRowActions(order)}</div>
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      {confirmDialog}

      <Drawer
        open={Boolean(drawerOrderId)}
        onClose={() => setDrawerOrderId(null)}
        title="Order details"
        widthClassName="max-w-2xl"
        onPrev={() => goToDrawerOffset(-1)}
        onNext={() => goToDrawerOffset(1)}
        prevDisabled={!hasPrevOrder}
        nextDisabled={!hasNextOrder}
        navLabel={drawerIndex !== -1 ? `${drawerIndex + 1} of ${items.length}` : undefined}
      >
        {drawerOrderId && (
          <OrderDetailPanel orderId={drawerOrderId} onClose={() => setDrawerOrderId(null)} variant="drawer" />
        )}
      </Drawer>

      <Modal
        open={Boolean(bulkCourierResult)}
        onClose={() => setBulkCourierResult(null)}
        title="Steadfast bulk booking results"
      >
        {bulkCourierResult && (
          <div className="space-y-4">
            <p className="text-sm text-ink-600">
              {bulkCourierResult.booked.length} booked, {bulkCourierResult.failed.length} failed.
            </p>
            {bulkCourierResult.booked.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-success-600">Booked</h3>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {bulkCourierResult.booked.map((b) => (
                    <li key={b.orderId} className="flex items-center justify-between gap-3">
                      <button
                        onClick={() => {
                          setBulkCourierResult(null);
                          setDrawerOrderId(b.orderId);
                        }}
                        className="text-info-600 hover:underline"
                      >
                        {b.orderNumber}
                      </button>
                      <span className="text-ink-400">{b.trackingNumber}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {bulkCourierResult.failed.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-danger-600">Failed</h3>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {bulkCourierResult.failed.map((f) => (
                    <li key={f.orderId} className="flex items-center justify-between gap-3">
                      <button
                        onClick={() => {
                          setBulkCourierResult(null);
                          setDrawerOrderId(f.orderId);
                        }}
                        className="text-info-600 hover:underline"
                      >
                        {f.orderNumber}
                      </button>
                      <span className="text-ink-400">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setBulkCourierResult(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
