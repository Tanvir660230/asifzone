"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  Eye,
  FileText,
  MoreHorizontal,
  Package,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  Truck,
} from "lucide-react";
import { allowedNextOrderStatuses, courierBookingBlocker, type AdminOrderListItem, type OrderListItemSummary } from "@clothing-brand/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Table, TableCell, TableContainer, TableHead, TableHeaderCell, TableMessageRow, TableRow, TableSkeleton } from "@/components/ui/table";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import { formatPrice, formatStoreDate, formatStoreTime, initials, orderStatusBadgeClass, orderStatusLabel, orderStatusShortLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CourierCell, DeliveryScoreBadge, OrderStatusBadge, PaymentBadges } from "./order-badges";
import { COURIER_PROVIDER_LABEL, orderAttention, type OrderPermissions } from "./order-domain";
import type { OrderCommands } from "./use-order-commands";
import type { SortColumn } from "./use-orders-list-state";
import { Thumbnail } from "@/components/admin/thumbnail";

// Left accent by status group: amber = waiting on someone, blue = in flight, green = done, red = cancelled.
export interface OrdersListProps {
  items: AdminOrderListItem[];
  total: number | undefined;
  isLoading: boolean;
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
}

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
          "inline-flex items-center gap-1 whitespace-nowrap font-semibold uppercase tracking-wider transition-colors",
          active ? "text-ink-900" : "text-ink-500 hover:text-ink-800",
        )}
      >
        {label}
        <Icon size={12} className={active ? "text-ink-900" : "text-ink-300"} aria-hidden="true" />
      </button>
    </TableHeaderCell>
  );
}

/** First line item at a glance; links to the live storefront product (opens a new tab). */
function ProductCell({ summary }: { summary: OrderListItemSummary }) {
  if (!summary.firstItem) return <span className="text-xs text-ink-400">—</span>;
  const { name, size, color, imageUrl, productSlug } = summary.firstItem;
  const extra = summary.totalItems - 1;
  const variant = [size, color].filter(Boolean).join(" / ");
  const subtitle = extra > 0 ? `${variant ? `${variant} · ` : ""}+${extra} more item${extra > 1 ? "s" : ""}` : variant;
  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line-subtle bg-ink-50">
        {imageUrl ? (
          <Thumbnail src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Package size={14} className="text-ink-300" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block max-w-[180px] truncate text-ink-800 group-hover/product:text-info-700 group-hover/product:underline">{name}</span>
        {subtitle && <span className="block max-w-[180px] truncate text-xs text-ink-400">{subtitle}</span>}
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

/** The status pill doubles as the status control: it lists only the moves the shared state machine allows from here. */
function StatusPicker({ order, commands, canManage }: { order: AdminOrderListItem; commands: OrderCommands; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const next = allowedNextOrderStatuses(order.status);
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
          "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium leading-none transition-opacity duration-fast hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          orderStatusBadgeClass(order.status),
        )}
      >
        <OrderStatusIcon status={order.status} size={12} className="shrink-0" />
        {orderStatusShortLabel(order.status)}
        <ChevronDown size={11} className="opacity-60" aria-hidden="true" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align="start" className="w-60 p-1.5">
        <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Move to</p>
        <div role="menu" aria-label={`Move ${order.orderNumber} to`}>
          {next.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                commands.requestStatusChange([order], s);
              }}
              className="ui-menu-item flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-900/[0.04]"
            >
              <OrderStatusIcon status={s} size={14} className="text-ink-400" />
              {orderStatusLabel(s)}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function rowActions(
  order: AdminOrderListItem,
  { commands, perms, onOpen, navigate }: Pick<OrdersListProps, "commands" | "perms" | "onOpen"> & { navigate: (href: string) => void },
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
  if (perms.courier) {
    if (!courierBookingBlocker(order)) items.push({ label: `Book with ${COURIER_PROVIDER_LABEL}`, icon: Truck, onClick: () => commands.bookCourier(order) });
    else if (order.courierConsignmentId) items.push({ label: "Sync courier status", icon: RefreshCw, onClick: () => commands.syncCourier(order) });
  }
  if (perms.trash) items.push({ label: "Move to Trash", icon: Trash2, destructive: true, onClick: () => commands.trash(order) });
  return items;
}

function RowActionsMenu({ order, ...ctx }: { order: AdminOrderListItem } & Pick<OrdersListProps, "commands" | "perms" | "onOpen">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  return (
    <>
      <IconButton ref={ref} onClick={() => setOpen((v) => !v)} aria-label={`Actions for ${order.orderNumber}`} aria-haspopup="menu" aria-expanded={open}>
        <MoreHorizontal size={16} />
      </IconButton>
      <DropdownMenu open={open} onClose={() => setOpen(false)} anchorRef={ref} items={rowActions(order, { ...ctx, navigate: router.push })} align="end" />
    </>
  );
}

/** A small marker next to the order number when something about it needs attention (full list in the detail view). */
function AttentionMarker({ order }: { order: AdminOrderListItem }) {
  const items = orderAttention(order).filter((i) => i.tone !== "info");
  if (items.length === 0) return null;
  const urgent = items.some((i) => i.tone === "danger");
  const text = items.map((i) => i.label).join(" · ");
  return (
    <span className={cn("inline-flex", urgent ? "text-danger-600" : "text-warning-600")} title={text}>
      <AlertCircle size={14} aria-hidden="true" />
      <span className="sr-only">Needs attention: {text}</span>
    </span>
  );
}

function CustomerCell({ order, commands, perms }: { order: AdminOrderListItem } & Pick<OrdersListProps, "commands" | "perms">) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-700" aria-hidden="true">
        {initials(order.customerName)}
      </span>
      <span className="min-w-0">
        <span className="block max-w-[180px] truncate text-ink-800">{order.customerName}</span>
        <span className="flex items-center gap-1.5 text-xs text-ink-400">
          <span>{order.customerPhone}</span>
          <DeliveryScoreBadge
            score={order.deliveryScore}
            onCheck={perms.manage && perms.courierConfigured ? () => commands.checkDeliveryScore([order], true) : undefined}
            checking={commands.pending.scoreOrderId === order.id}
          />
        </span>
      </span>
    </span>
  );
}

/** ≥xl: the data table. Below xl: cards — a compressed table on a touch tablet reads worse than fewer, larger cards. */
export function OrdersList(props: OrdersListProps) {
  const { items, isLoading, selected, onToggle, onToggleAll, onOpen, commands, perms, empty } = props;
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));

  return (
    <>
      <TableContainer className="mt-4 hidden xl:block">
        <Table aria-label="Orders">
          <TableHead>
            <tr>
              <TableHeaderCell className="w-10 px-3 py-2.5">
                <Checkbox checked={allSelected} onChange={onToggleAll} aria-label="Select all orders on this page" />
              </TableHeaderCell>
              <SortableHeader column="orderNumber" label="Order" props={props} />
              <TableHeaderCell className="px-3 py-2.5">Product</TableHeaderCell>
              <SortableHeader column="customerName" label="Customer" props={props} />
              <SortableHeader column="paymentStatus" label="Payment" props={props} />
              <SortableHeader column="total" label="Total" props={props} align="right" />
              <SortableHeader column="status" label="Status" props={props} />
              <TableHeaderCell className="px-3 py-2.5">Courier</TableHeaderCell>
              <SortableHeader column="createdAt" label="Placed" props={props} className="hidden 2xl:table-cell" />
              <TableHeaderCell align="right" className="px-3 py-2.5">
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <tbody>
            {isLoading && <TableSkeleton rows={6} cols={10} />}
            {!isLoading && items.length === 0 && <TableMessageRow colSpan={10}>{empty}</TableMessageRow>}
            {items.map((order) => (
              <TableRow key={order.id} className={cn(selected.has(order.id) && "bg-accent/[0.05]")} data-testid="order-row">
                <TableCell className="px-3 py-2.5">
                  <Checkbox checked={selected.has(order.id)} onChange={() => onToggle(order.id)} aria-label={`Select ${order.orderNumber}`} />
                </TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2.5">
                  <span className="flex items-center gap-1.5">
                    <button type="button" onClick={() => onOpen(order.id)} className="font-medium text-ink-900 underline-offset-2 hover:text-accent hover:underline">
                      {order.orderNumber}
                    </button>
                    <AttentionMarker order={order} />
                  </span>
                  {/* Below 2xl the Placed column folds in here, so the table fits without sideways scrolling. */}
                  <span className="mt-0.5 block text-xs text-fg-subtle 2xl:hidden">
                    {formatStoreDate(order.createdAt)} · {formatStoreTime(order.createdAt)}
                  </span>
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <ProductCell summary={order.itemsSummary} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <CustomerCell order={order} commands={commands} perms={perms} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <PaymentBadges method={order.paymentMethod} status={order.paymentStatus} />
                </TableCell>
                <TableCell align="right" className="px-3 py-2.5 font-medium text-ink-900">
                  {formatPrice(order.total)}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <StatusPicker order={order} commands={commands} canManage={perms.manage} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <CourierCell order={order} />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap px-3 py-2.5 text-ink-500 2xl:table-cell">
                  <span className="block">{formatStoreDate(order.createdAt)}</span>
                  <span className="block text-xs text-ink-400">{formatStoreTime(order.createdAt)}</span>
                </TableCell>
                <TableCell align="right" className="px-3 py-2.5">
                  <RowActionsMenu order={order} commands={commands} perms={perms} onOpen={onOpen} />
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </TableContainer>

      <div className="mt-4 xl:hidden">
        {!isLoading && items.length > 0 && (
          <label className="mb-3 flex min-h-[44px] items-center gap-2.5 rounded-xl border border-line-subtle bg-surface px-3.5 text-sm text-ink-600 shadow-sm">
            <Checkbox checked={allSelected} onChange={onToggleAll} />
            Select all on this page
            <span className="ml-auto text-xs tabular-nums text-ink-400">{props.total ?? items.length} total</span>
          </label>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {isLoading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-44 rounded-xl border border-line-subtle bg-surface ui-skeleton" aria-hidden="true" />
            ))}
          {!isLoading && items.length === 0 && <div className="col-span-full rounded-xl border border-line-subtle bg-surface">{empty}</div>}
          {items.map((order) => {
            const canBook = perms.courier && !courierBookingBlocker(order);
            return (
              <article
                key={order.id}
                aria-label={`Order ${order.orderNumber}`}
                data-testid="order-card"
                className={cn(
                  "flex flex-col rounded-xl border border-line bg-surface p-3.5 shadow",
                  selected.has(order.id) && "ring-2 ring-accent/40",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <Checkbox checked={selected.has(order.id)} onChange={() => onToggle(order.id)} className="mt-1" aria-label={`Select ${order.orderNumber}`} />
                  <button type="button" onClick={() => onOpen(order.id)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium text-ink-900">
                        {order.orderNumber}
                        <AttentionMarker order={order} />
                      </span>
                      <span className="font-semibold tabular-nums text-ink-900">{formatPrice(order.total)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-400">
                      {formatStoreDate(order.createdAt)} · {formatStoreTime(order.createdAt)}
                    </span>
                  </button>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line-subtle pt-2.5">
                  <StatusPicker order={order} commands={commands} canManage={perms.manage} />
                  <PaymentBadges method={order.paymentMethod} status={order.paymentStatus} layout="inline" />
                  <span className="ml-auto">
                    <CourierCell order={order} compact />
                  </span>
                </div>

                <div className="mt-2.5 border-t border-line-subtle pt-2.5">
                  <ProductCell summary={order.itemsSummary} />
                </div>
                <div className="mt-2.5 border-t border-line-subtle pt-2.5">
                  <CustomerCell order={order} commands={commands} perms={perms} />
                </div>

                {/* The single most common next step stays one tap away; everything else lives in the ⋯ menu. */}
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-subtle pt-2.5">
                  {order.deletedAt ? (
                    perms.trash ? (
                      <Button variant="outline" size="sm" onClick={() => commands.restore(order)}>
                        <RotateCcw size={13} /> Restore
                      </Button>
                    ) : (
                      <span />
                    )
                  ) : canBook ? (
                    <Button variant="outline" size="sm" disabled={commands.pending.book} onClick={() => commands.bookCourier(order)}>
                      <Truck size={13} /> Book courier
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => onOpen(order.id)}>
                      <Eye size={13} /> View
                    </Button>
                  )}
                  <RowActionsMenu order={order} commands={commands} perms={perms} onOpen={onOpen} />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
