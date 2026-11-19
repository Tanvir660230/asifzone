"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  FileText,
  MoreHorizontal,
  Package,
  PackageCheck,
  Phone,
  Printer,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Truck,
} from "lucide-react";
import { allowedNextOrderStatuses, courierBookingBlocker, type AdminOrderListItem, type ListDensity, type OrderListItemSummary } from "@clothing-brand/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import { formatCount, formatPrice, formatStoreDate, formatStoreTime, orderStatusBadgeClass, orderStatusLabel, orderStatusShortLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CourierCell, DeliveryScoreBadge, OrderRiskBadge, OrderStatusBadge, PaymentBadges } from "./order-badges";
import { useOrderRisk } from "./use-order-risk";
import type { OrderRisk } from "@/lib/api/admin-analytics";
import { COURIER_PROVIDER_LABEL, nextStatusesFor, orderAttention, prefetchOrder, type OrderPermissions } from "./order-domain";
import { canMarkPacked, type OrderCommands } from "./use-order-commands";
import type { OrderOptionalColumn, SortColumn } from "./use-orders-list-state";
import { Thumbnail } from "@/components/admin/thumbnail";
import { useShortcut } from "@/hooks/use-shortcut";

export interface OrdersListProps {
  items: AdminOrderListItem[];
  total: number | undefined;
  isLoading: boolean;
  /** A refetch (poll, filter change) is in flight — announced as aria-busy on the list. */
  isFetching?: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  sortBy: SortColumn | undefined;
  sortDir: "asc" | "desc";
  onSort: (column: SortColumn) => void;
  onOpen: (id: string) => void;
  commands: OrderCommands;
  perms: OrderPermissions;
  empty: ReactNode;
  /** Row height (plan M10) — the table's cell padding; the phone cards keep one size. */
  density?: ListDensity;
  /** Optional columns this admin has hidden. */
  hiddenColumns?: ReadonlySet<OrderOptionalColumn>;
  /** Order history: no selection, no status moves, no booking — open, print and invoice only. Corrections happen on the
   * order itself, through the workflows that keep their own trail (refunds, returns, payments). */
  readOnly?: boolean;
}

/** From xl the Orders pages are a fixed-height workspace: the page fills the window under the top bar (less main's
 * 1.25rem top + 2rem bottom padding, and 2px of chrome borders) and only the table's rows scroll. Pages pass it to ListPage's className. */
export const ORDERS_WORKSPACE_CLASS = "xl:flex xl:h-[calc(100dvh-var(--density-chrome)-3.25rem-2px)] xl:flex-col";

/** Cell padding per density: compact fits about twice the rows of comfortable on one screen. */
const DENSITY_PAD: Record<ListDensity, string> = {
  compact: "px-3 py-1",
  standard: "px-3 py-1.5",
  comfortable: "px-3 py-3.5",
};
/** Every column the table can draw: checkbox, order, product, customer, payment, total, status, courier, placed, actions. */
const ALL_COLUMNS = 10;

function SortableHeader({ column, label, props, align, className }: { column: SortColumn; label: string; props: OrdersListProps; align?: "right"; className?: string }) {
  const active = props.sortBy === column;
  const Icon = active ? (props.sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHeaderCell
      align={align}
      className={cn("px-3 py-2.5", className)}
      aria-sort={active ? (props.sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => props.onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap font-semibold transition-colors",
          active ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
        )}
      >
        {label}
        <Icon size={12} className={active ? "text-ink-900" : "text-fg-subtle"} aria-hidden="true" />
      </button>
    </TableHeaderCell>
  );
}

/** First line item at a glance; links to the live storefront product (opens a new tab). */
function ProductCell({ summary, compact = false }: { summary: OrderListItemSummary; compact?: boolean }) {
  if (!summary.firstItem) return <span className="text-xs text-ink-400">—</span>;
  const { name, size, color, imageUrl, productSlug } = summary.firstItem;
  const extra = summary.totalItems - 1;
  // Size and colour lead: a page of one product (every row "Haven Sleeveless Jacket – …") differs only there.
  const variant = [size, color].filter(Boolean).join(" · ");
  const more = extra > 0 ? `+${extra} more item${extra > 1 ? "s" : ""}` : "";
  const lead = compact ? [variant, name].filter(Boolean).join(" · ") : variant || name;
  const subtitle = compact ? "" : [variant ? name : "", more].filter(Boolean).join(" · ");
  const content = (
    <>
      <span
        className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-subtle bg-ink-50", compact ? "h-6 w-6" : "h-9 w-9")}
      >
        {imageUrl ? (
          <Thumbnail src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Package size={14} className="text-ink-300" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className={cn("block max-w-[200px] truncate text-ink-800 group-hover/product:text-info-700 group-hover/product:underline", variant && "font-medium")}>{lead}</span>
        {subtitle && <span className="block max-w-[200px] truncate text-xs text-fg-muted">{subtitle}</span>}
      </span>
    </>
  );
  if (!productSlug) {
    return (
      <span className="flex items-center gap-2.5 opacity-75" title={`${name} — product no longer available`}>
        {content}
      </span>
    );
  }
  return (
    <Link prefetch={false} href={`/product/${productSlug}`} target="_blank" className="group/product flex items-center gap-2.5" title={`View ${name} on the store (new tab)`}>
      {content}
    </Link>
  );
}

/** The card's line of goods: the first item's photo and name, its variant, and how many more there are. Plain text — the
 * whole card opens the order, so it can't hold the table's link to the storefront. */
function CardItems({ summary }: { summary: OrderListItemSummary }) {
  if (!summary.firstItem) return null;
  const { name, size, color, imageUrl } = summary.firstItem;
  const extra = summary.totalItems - 1;
  const variant = [size, color].filter(Boolean).join(" · ");
  return (
    <span className="mt-2 flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-subtle bg-ink-50">
        {imageUrl ? (
          <Thumbnail src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Package size={13} className="text-ink-300" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 truncate text-sm text-ink-700">
        {variant && <span className="font-semibold text-fg">{variant} · </span>}
        {name}
        {extra > 0 && <span className="text-fg-subtle"> · +{extra} more</span>}
      </span>
    </span>
  );
}

/** The status pill doubles as the status control: it lists only the moves the shared state machine allows from here. */
function StatusPicker({ order, commands, canManage, canCancel }: { order: AdminOrderListItem; commands: OrderCommands; canManage: boolean; canCancel: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const next = nextStatusesFor(order.status, { cancel: canCancel });
  if (order.deletedAt || !canManage || next.length === 0) return <OrderStatusBadge status={order.status} short className="h-8" />;
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status ${orderStatusLabel(order.status)} — change status of ${order.orderNumber}`}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none transition-opacity duration-fast hover:opacity-85",
          orderStatusBadgeClass(order.status),
        )}
      >
        <OrderStatusIcon status={order.status} size={12} className="shrink-0" />
        {orderStatusShortLabel(order.status)}
        <ChevronDown size={11} className="opacity-60" aria-hidden="true" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="start" role="menu" aria-label={`Move ${order.orderNumber} to`} className="w-60 p-1.5">
        <p className="px-2.5 pb-1 pt-1 text-xs font-medium text-fg-muted" aria-hidden="true">
          Move to
        </p>
        {next.map((s) => (
          <button
            key={s}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              commands.requestStatusChange([order], s);
            }}
            className="ui-menu-item"
          >
            <OrderStatusIcon status={s} size={14} className="shrink-0" />
            {orderStatusLabel(s)}
          </button>
        ))}
      </Popover>
    </>
  );
}

function rowActions(
  order: AdminOrderListItem,
  { commands, perms, onOpen, navigate, readOnly }: Pick<OrdersListProps, "commands" | "perms" | "onOpen" | "readOnly"> & { navigate: (href: string) => void },
): DropdownMenuItem[] {
  const view: DropdownMenuItem = { label: "Quick view", icon: Eye, onClick: () => onOpen(order.id) };
  const page: DropdownMenuItem = { label: "Open full page", icon: ExternalLink, onClick: () => navigate(`/admin/orders/${order.id}`) };
  if (order.deletedAt) {
    return [
      view,
      ...(perms.trash
        ? [
            { label: "Restore", icon: RotateCcw, onClick: () => commands.restore(order) },
            { label: "Delete permanently", icon: Trash2, destructive: true, onClick: () => commands.purge(order) },
          ]
        : []),
    ];
  }
  const items: DropdownMenuItem[] = [view, page];
  items.push({ label: "Print label", icon: Printer, onClick: () => commands.printLabels([order.id]) });
  items.push({ label: "Invoice", icon: FileText, onClick: () => window.open(`/admin/orders/${order.id}/invoice`, "_blank") });
  if (readOnly) return items;
  if (perms.courier) {
    if (!courierBookingBlocker(order)) items.push({ label: `Book with ${COURIER_PROVIDER_LABEL}`, icon: Truck, onClick: () => commands.bookCourier(order) });
    else if (order.courierConsignmentId) items.push({ label: "Sync courier status", icon: RefreshCw, onClick: () => commands.syncCourier(order) });
  } else if (perms.courierNotConnected && !courierBookingBlocker(order)) {
    items.push({ label: `Book with ${COURIER_PROVIDER_LABEL}`, icon: Truck, onClick: commands.explainCourierNotConnected });
  }
  if (perms.manage && perms.courierConfigured && !order.deliveryScore) {
    items.push({ label: "Check delivery score", icon: ShieldCheck, onClick: () => commands.checkDeliveryScore([order], true) });
  }
  if (perms.trash) items.push({ label: "Move to Trash", icon: Trash2, destructive: true, onClick: () => commands.trash(order) });
  return items;
}

function RowActionsMenu({ order, ...ctx }: { order: AdminOrderListItem } & Pick<OrdersListProps, "commands" | "perms" | "onOpen" | "readOnly">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  return (
    <>
      <IconButton ref={ref} onClick={() => setOpen((v) => !v)} aria-label={`Actions for ${order.orderNumber}`} aria-haspopup="menu" aria-expanded={open}>
        <MoreHorizontal size={16} />
      </IconButton>
      <DropdownMenu
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref}
        items={rowActions(order, { ...ctx, navigate: router.push })}
        align="end"
        label={`Actions for ${order.orderNumber}`}
      />
    </>
  );
}

/** Whether the order changed status after it was placed. The same transaction as the order itself (a phone order
 * confirmed on creation) is no separate move. */
function hasMoved(order: AdminOrderListItem): boolean {
  const moved = order.statusChangedAt;
  return Boolean(moved) && new Date(moved!).getTime() - new Date(order.createdAt).getTime() >= 1_000;
}

/** "Packed 29 Oct · 4:10 pm" — when the order moved to its current status, if that was after it was placed. */
function MovedLine({ order }: { order: AdminOrderListItem }) {
  const moved = order.statusChangedAt;
  if (!moved || !hasMoved(order)) return null;
  return (
    <span className="mt-0.5 block text-xs text-fg-subtle" data-testid="order-moved" title={`Placed ${formatStoreDate(order.createdAt)} · ${formatStoreTime(order.createdAt)}`}>
      {orderStatusShortLabel(order.status)} {formatStoreDate(moved)} · {formatStoreTime(moved)}
    </span>
  );
}

/** What about the order needs attention, in words (the first item, "+n" for more; the full list is in the detail view).
 * A tooltip-only icon said nothing on a phone and, on every row, nothing at all. `hideSyncError`: the list's banner
 * already covers a sync failure shared by many orders. */
function AttentionMarker({ order, hideSyncError = false }: { order: AdminOrderListItem; hideSyncError?: boolean }) {
  const items = orderAttention(order).filter((i) => i.tone !== "info" && !(hideSyncError && i.key === "courier-sync"));
  if (items.length === 0) return null;
  const urgent = items.some((i) => i.tone === "danger");
  const first = items.find((i) => i.tone === "danger") ?? items[0]!;
  const text = items.map((i) => i.label).join(" · ");
  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-[210px] items-center gap-1 rounded-md px-1.5 py-px text-xs font-medium",
        urgent ? "bg-danger-100 text-danger-700" : "bg-warning-100 text-warning-700",
      )}
      title={text}
      data-testid="order-attention"
    >
      <AlertCircle size={11} className="shrink-0" aria-hidden="true" />
      <span className="sr-only">Needs attention: {text}</span>
      <span className="truncate" aria-hidden="true">{first.label}</span>
      {items.length > 1 && <span className="shrink-0" aria-hidden="true">+{items.length - 1}</span>}
    </span>
  );
}

/** One courier sync error shared by 3+ orders on the page is a key or connection problem, not 3 parcel problems: the
 * list says it once (above the rows) and the rows stop repeating it. */
function sharedCourierSyncError(items: AdminOrderListItem[]): { message: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const o of items) if (o.courierSyncError) counts.set(o.courierSyncError, (counts.get(o.courierSyncError) ?? 0) + 1);
  let top: { message: string; count: number } | null = null;
  for (const [message, count] of counts) if (count >= 3 && (!top || count > top.count)) top = { message, count };
  return top;
}

function CustomerCell({ order, commands, perms, risk }: { order: AdminOrderListItem; risk?: OrderRisk } & Pick<OrdersListProps, "commands" | "perms">) {
  return (
    <span className="flex items-center">
      <span className="min-w-0">
        <span className="block max-w-[180px] truncate text-ink-800" title={order.customerName}>
          {order.customerName}
        </span>
        {/* Never wrapped, and tap-to-call: a COD order is confirmed by phoning this number. */}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-fg-subtle">
          <a
            href={`tel:${order.customerPhone}`}
            className="whitespace-nowrap tabular-nums underline-offset-2 hover:text-fg hover:underline"
            aria-label={`Call ${order.customerName} on ${order.customerPhone}`}
          >
            {order.customerPhone}
          </a>
          <DeliveryScoreBadge
            score={order.deliveryScore}
            onCheck={perms.manage && perms.courierConfigured ? () => commands.checkDeliveryScore([order], true) : undefined}
            checking={commands.pending.scoreOrderId === order.id}
            onlyIfWorrying
          />
          <OrderRiskBadge risk={risk} />
        </span>
      </span>
    </span>
  );
}

/** ≥xl: the data table. Below xl: cards — a compressed table on a touch tablet reads worse than fewer, larger cards. */
export function OrdersList(props: OrdersListProps) {
  const { items, isLoading, selected, onToggle, onToggleAll, onOpen, commands, empty, density = "standard", hiddenColumns, readOnly = false } = props;
  // Read-only (Order history): nothing that changes an order is offered — no status picker, booking or confirm.
  const perms = readOnly ? { ...props.perms, manage: false, cancel: false, courier: false, courierNotConnected: false, trash: false } : props.perms;
  const pad = DENSITY_PAD[density];
  const shows = (column: OrderOptionalColumn) => !hiddenColumns?.has(column);
  const columnCount = ALL_COLUMNS - (hiddenColumns?.size ?? 0) - (readOnly ? 1 : 0);
  // A row the pointer rests on (120 ms — not one it sweeps across) or that takes keyboard focus has its detail fetched,
  // so Quick view opens already filled in.
  const queryClient = useQueryClient();
  const hoverTimer = useRef<number | undefined>(undefined);
  const warm = (id: string) => ({
    onMouseEnter: () => {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => prefetchOrder(queryClient, id), 120);
    },
    onMouseLeave: () => window.clearTimeout(hoverTimer.current),
    onFocus: () => prefetchOrder(queryClient, id),
  });
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));
  // COD risk of the undecided orders on this page — one batched lookup (§4.8).
  const risk = useOrderRisk(items);
  const syncProblem = readOnly ? null : sharedCourierSyncError(items);
  const hideSync = (o: AdminOrderListItem) => Boolean(syncProblem && o.courierSyncError === syncProblem.message);

  // Keyboard (the registry's list shortcuts): J/K move the highlighted row, Enter opens it, X selects it. Bound only while
  // focus is inside the table, like DataTable, so nothing else on the page competes for the keys.
  const [focused, setFocused] = useState(false);
  // Enter/X only while the table itself has focus: on a button inside a row, Enter must stay that button's.
  const [onTable, setOnTable] = useState(false);
  // The highlight follows the ORDER, not the row number: the 30 s refresh hands over a new list, and the row the admin
  // was on must stay highlighted (it clears only when that order leaves the view).
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = activeId ? items.findIndex((o) => o.id === activeId) : -1;
  const active = activeIndex >= 0 ? items[activeIndex] : undefined;
  useEffect(() => {
    if (!activeId) return;
    prefetchOrder(queryClient, activeId);
    document.querySelector<HTMLElement>(`[data-testid="order-row"][data-order-id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, queryClient]);
  const keys = { enabled: focused && items.length > 0 };
  const moveActive = (step: number) => {
    const from = activeIndex === -1 ? (step > 0 ? -1 : items.length) : activeIndex;
    const next = items[Math.min(Math.max(from + step, 0), items.length - 1)];
    if (next) setActiveId(next.id);
  };
  useShortcut("list.next", () => moveActive(1), keys);
  useShortcut("list.prev", () => moveActive(-1), keys);
  useShortcut("list.open", () => active && onOpen(active.id), { enabled: keys.enabled && onTable && Boolean(active) });
  useShortcut("list.select", () => active && onToggle(active.id), { enabled: keys.enabled && onTable && Boolean(active) && !readOnly });
  // P / B / L on the highlighted row: the packing table's and the booking desk's repeat jobs without the mouse.
  const rowKeys = { enabled: keys.enabled && onTable && Boolean(active) && !readOnly };
  useShortcut("orders.markPacked", () => active && perms.manage && canMarkPacked(active) && commands.markPacked([active]), rowKeys);
  useShortcut(
    "orders.book",
    () => active && !courierBookingBlocker(active) && (perms.courier ? commands.bookCourier(active) : perms.courierNotConnected && commands.explainCourierNotConnected()),
    rowKeys,
  );
  useShortcut("orders.printLabel", () => active && !active.deletedAt && commands.printLabels([active.id]), rowKeys);

  return (
    <>
      {syncProblem && (
        <p role="status" data-testid="courier-sync-banner" className="mt-3 flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Courier sync failing on {formatCount(syncProblem.count)} orders: “<span className="break-all">{syncProblem.message}</span>”. Usually the courier key.{" "}
            <Link href="/admin/settings?pane=integrations" className="whitespace-nowrap font-medium underline underline-offset-2">
              Check Integrations
            </Link>
          </span>
        </p>
      )}
      {/* From xl the page is a fixed-height workspace (ORDERS_WORKSPACE_CLASS on the page): this frame takes the room left
          under the toolbar and only the rows scroll, under their sticky titles. One scroller, so the page never slides the
          frame up under the toolbar (the 2026-11-19 overlap). */}
      <TableContainer
        className="mt-3 hidden xl:flex xl:min-h-[18rem] xl:flex-1 xl:flex-col"
        wrapperClassName="xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"
        scrollClassName="xl:min-h-0 xl:flex-1 xl:overflow-y-auto"
      >
        <Table
          aria-label="Orders"
          aria-busy={props.isFetching || undefined}
          tabIndex={0}
          data-density={density}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          onFocus={(e) => {
            setFocused(true);
            setOnTable(e.target === e.currentTarget);
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
            setOnTable(false);
          }}
        >
          <TableHead className="sticky top-0 z-raised">
            <tr>
              {!readOnly && (
                <TableHeaderCell className="w-10 px-3 py-2.5">
                  <Checkbox checked={allSelected} onChange={onToggleAll} aria-label="Select all orders on this page" />
                </TableHeaderCell>
              )}
              <SortableHeader column="orderNumber" label="Order" props={props} />
              {shows("product") && <TableHeaderCell className="px-3 py-2.5">Product</TableHeaderCell>}
              <SortableHeader column="customerName" label="Customer" props={props} />
              {shows("payment") && <SortableHeader column="paymentStatus" label="Payment" props={props} className="hidden 2xl:table-cell" />}
              {shows("total") && <SortableHeader column="total" label="Total" props={props} align="right" />}
              <SortableHeader column="status" label="Status" props={props} />
              {/* On a 1280 laptop the courier sits under the status (compact): the full column only fits from 2xl. */}
              {shows("courier") && <TableHeaderCell className="hidden px-3 py-2.5 2xl:table-cell">Courier</TableHeaderCell>}
              {shows("placed") && <SortableHeader column="createdAt" label="Placed" props={props} className="hidden 2xl:table-cell" />}
              <TableHeaderCell align="right" className="px-3 py-2.5">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} cols={columnCount} />}
            {!isLoading && items.length === 0 && <TableMessageRow colSpan={columnCount}>{empty}</TableMessageRow>}
            {items.map((order, index) => (
              <TableRow
                key={order.id}
                className={cn(selected.has(order.id) && "bg-accent/[0.05]", index === activeIndex && "bg-ink-50 outline outline-1 -outline-offset-1 outline-ink-300")}
                data-testid="order-row"
                data-row-index={index}
                data-order-id={order.id}
                data-active={index === activeIndex || undefined}
                {...warm(order.id)}
              >
                {!readOnly && (
                  <TableCell className={pad}>
                    <Checkbox checked={selected.has(order.id)} onChange={() => onToggle(order.id)} aria-label={`Select ${order.orderNumber}`} />
                  </TableCell>
                )}
                <TableCell className={cn("whitespace-nowrap", pad)}>
                  <span className="flex items-center gap-1.5">
                    <button type="button" onClick={() => onOpen(order.id)} className="font-medium text-ink-900 underline-offset-2 hover:text-accent hover:underline">
                      {order.orderNumber}
                    </button>
                  </span>
                  {/* Below 2xl the Placed column folds in here, so the table fits without sideways scrolling. A row is two
                      lines at most: once the order has moved, the line says when (its tooltip keeps the placed time). */}
                  {shows("placed") && density !== "compact" && !hasMoved(order) && (
                    <span className="mt-0.5 block text-xs text-fg-subtle 2xl:hidden">
                      {formatStoreDate(order.createdAt)} · {formatStoreTime(order.createdAt)}
                    </span>
                  )}
                  {/* Sorted by latest activity, an order placed days ago can sit at the top — say when it last moved. */}
                  {density !== "compact" && <MovedLine order={order} />}
                  {/* A problem gets its own line, so the words never widen the column (rows without one stay two lines). */}
                  <span className="mt-1 flex empty:hidden">
                    <AttentionMarker order={order} hideSyncError={hideSync(order)} />
                  </span>
                </TableCell>
                {shows("product") && (
                  <TableCell className={pad}>
                    <ProductCell summary={order.itemsSummary} compact={density === "compact"} />
                  </TableCell>
                )}
                <TableCell className={pad}>
                  <CustomerCell order={order} commands={commands} perms={perms} risk={risk[order.id]} />
                </TableCell>
                {shows("payment") && (
                  <TableCell className={cn("hidden 2xl:table-cell", pad)}>
                    <PaymentBadges method={order.paymentMethod} status={order.paymentStatus} quiet />
                  </TableCell>
                )}
                {shows("total") && (
                  <TableCell align="right" className={cn("font-medium text-ink-900", pad)}>
                    {formatPrice(order.total)}
                    {/* On a 1280 laptop how it's paid sits under the amount; the Payment column fits from 2xl. */}
                    {shows("payment") && (
                      <div className="mt-1 flex justify-end font-normal 2xl:hidden">
                        <PaymentBadges method={order.paymentMethod} status={order.paymentStatus} layout="inline" quiet />
                      </div>
                    )}
                  </TableCell>
                )}
                <TableCell className={pad}>
                  <span className="flex items-center gap-1.5">
                    <StatusPicker order={order} commands={commands} canManage={perms.manage} canCancel={perms.cancel} />
                    {/* The packing table's one job: being prepared → Packed, one click (Undo in the toast). */}
                    {perms.manage && order.status === "PROCESSING" && canMarkPacked(order) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 whitespace-nowrap"
                        disabled={commands.pending.pack}
                        onClick={() => commands.markPacked([order])}
                        aria-label={`Mark ${order.orderNumber} packed`}
                        title="Mark packed (P on the highlighted row)"
                        data-testid="row-mark-packed"
                      >
                        <PackageCheck size={13} /> Packed
                      </Button>
                    )}
                  </span>
                  {shows("courier") && order.courierConsignmentId && (
                    <div className="mt-1 2xl:hidden">
                      <CourierCell order={order} compact hideSyncError={hideSync(order)} />
                    </div>
                  )}
                </TableCell>
                {shows("courier") && (
                  <TableCell className={cn("hidden 2xl:table-cell", pad)}>
                    <CourierCell order={order} hideSyncError={hideSync(order)} />
                  </TableCell>
                )}
                {shows("placed") && (
                  <TableCell className={cn("hidden whitespace-nowrap text-ink-500 2xl:table-cell", pad)}>
                    <span className="block">{formatStoreDate(order.createdAt)}</span>
                    <span className="block text-xs text-ink-400">{formatStoreTime(order.createdAt)}</span>
                  </TableCell>
                )}
                <TableCell align="right" className={pad}>
                  <RowActionsMenu order={order} commands={commands} perms={perms} onOpen={onOpen} readOnly={readOnly} />
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableContainer>

      <div className="mt-3 xl:hidden" aria-busy={props.isFetching || undefined}>
        {!isLoading && items.length > 0 && (
          readOnly ? (
            <p className="mb-1.5 flex min-h-[40px] items-center px-1 text-sm tabular-nums text-fg-subtle">{formatCount(props.total ?? items.length)} orders</p>
          ) : (
            <label className="mb-1.5 flex min-h-[40px] items-center gap-2.5 px-1 text-sm text-fg-muted">
              <Checkbox checked={allSelected} onChange={onToggleAll} />
              Select all on this page
              <span className="ml-auto tabular-nums text-fg-subtle">{formatCount(props.total ?? items.length)} orders</span>
            </label>
          )
        )}
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3">
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-36 rounded-xl border border-line-subtle bg-surface ui-skeleton" aria-hidden="true" />
            ))}
          {!isLoading && items.length === 0 && <div className="col-span-full rounded-xl border border-line-subtle bg-surface">{empty}</div>}
          {items.map((order) => {
            const canBook = (perms.courier || perms.courierNotConnected) && !courierBookingBlocker(order);
            // A pending order's first job is the confirmation call, so Confirm leads the card while it is a legal move.
            const canConfirm = perms.manage && !order.deletedAt && order.status === "PENDING" && allowedNextOrderStatuses(order.status).includes("CONFIRMED");
            // Booked and being prepared: the next job is packing it.
            const canPack = perms.manage && order.status === "PROCESSING" && canMarkPacked(order);
            return (
              <article
                key={order.id}
                aria-label={`Order ${order.orderNumber}`}
                data-testid="order-card"
                className={cn(
                  "flex flex-col rounded-xl border border-line bg-surface p-3 shadow",
                  selected.has(order.id) && "ring-2 ring-accent/40",
                )}
              >
                {/* A Mail-style row: who and how much, then the order and when, then what they bought. The whole block opens
                    the order; the checkbox beside it selects for a bulk action. */}
                <div className="flex items-start gap-1">
                  {/* 44px hit area around the 16px box: selecting cards for a bulk action is a thumb job. */}
                  {!readOnly && (
                    <label className="-my-2.5 -ml-2.5 flex h-11 w-10 shrink-0 cursor-pointer items-center justify-center">
                      <Checkbox checked={selected.has(order.id)} onChange={() => onToggle(order.id)} aria-label={`Select ${order.orderNumber}`} />
                    </label>
                  )}
                  <button type="button" onClick={() => onOpen(order.id)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-base font-semibold text-fg">{order.customerName}</span>
                      <span className="shrink-0 text-base font-semibold tabular-nums text-fg">{formatPrice(order.total)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-3 text-xs text-fg-subtle">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate">
                          {order.orderNumber} · {formatStoreDate(order.createdAt)}, {formatStoreTime(order.createdAt)}
                        </span>
                      </span>
                      <PaymentBadges method={order.paymentMethod} status={order.paymentStatus} layout="inline" quiet />
                    </span>
                    <CardItems summary={order.itemsSummary} />
                    <span className="mt-1.5 flex empty:hidden">
                      <AttentionMarker order={order} hideSyncError={hideSync(order)} />
                    </span>
                  </button>
                </div>

                {/* Where it stands, and the single most common next step one tap away; everything else in the ⋯ menu. */}
                {/* Two groups: where it stands (wraps under itself on a narrow phone) and the actions, which never get cut off. */}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    <StatusPicker order={order} commands={commands} canManage={perms.manage} canCancel={perms.cancel} />
                    {order.courierConsignmentId && <CourierCell order={order} compact hideSyncError={hideSync(order)} />}
                    {order.deliveryScore && <DeliveryScoreBadge score={order.deliveryScore} onlyIfWorrying />}
                    <OrderRiskBadge risk={risk[order.id]} />
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                  {!order.deletedAt && (
                    <a
                      href={`tel:${order.customerPhone}`}
                      aria-label={`Call ${order.customerName} on ${order.customerPhone}`}
                      title={order.customerPhone}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent transition-colors duration-fast hover:bg-accent/10 active:bg-accent/15"
                    >
                      <Phone size={16} aria-hidden="true" />
                    </a>
                  )}
                  {order.deletedAt ? (
                    perms.trash ? (
                      <Button variant="outline" size="sm" onClick={() => commands.restore(order)}>
                        <RotateCcw size={13} /> Restore
                      </Button>
                    ) : null
                  ) : canConfirm ? (
                    // Opens the order on its call panel: a confirmation is recorded with its call outcome (Change status still
                    // confirms without one).
                    <Button variant="outline" size="sm" onClick={() => onOpen(order.id)}>
                      <Check size={13} /> Confirm
                    </Button>
                  ) : canPack ? (
                    <Button variant="outline" size="sm" disabled={commands.pending.pack} onClick={() => commands.markPacked([order])} data-testid="card-mark-packed">
                      <PackageCheck size={13} /> Packed
                    </Button>
                  ) : canBook ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={commands.pending.book}
                      onClick={() => (perms.courier ? commands.bookCourier(order) : commands.explainCourierNotConnected())}
                    >
                      <Truck size={13} /> Book courier
                    </Button>
                  ) : null}
                  <RowActionsMenu order={order} commands={commands} perms={perms} onOpen={onOpen} readOnly={readOnly} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
