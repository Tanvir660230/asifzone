"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ExternalLink, FileText, MoreHorizontal, Printer, RotateCcw, Trash2 } from "lucide-react";
import { allowedNextOrderStatuses, suggestedNextOrderStatus, type Order } from "@clothing-brand/shared";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import { formatStoreDateTime, orderStatusLabel } from "@/lib/format";
import { OrderStatusBadge, PaymentBadges } from "../order-badges";
import { OrderProgress } from "./order-progress";
import type { OrderPermissions } from "../order-domain";
import type { OrderCommands } from "../use-order-commands";


/** 1 — identity and status: number, status, when, how it's paid; the next step and the status control; document and
 * Trash actions. */
export function DetailHeader({
  order,
  variant,
  commands,
  perms,
  onClose,
}: {
  order: Order;
  variant: "page" | "drawer";
  commands: OrderCommands;
  perms: OrderPermissions;
  onClose: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const statusRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const deleted = Boolean(order.deletedAt);
  const canChangeStatus = perms.manage && !deleted;
  const next = canChangeStatus ? suggestedNextOrderStatus(order.status) : null;
  const allowed = canChangeStatus ? allowedNextOrderStatuses(order.status) : [];
  const Heading = variant === "page" ? "h1" : "h2";

  const menu: DropdownMenuItem[] = !perms.trash
    ? []
    : deleted
      ? [
          { label: "Restore", icon: RotateCcw, onClick: () => commands.restore(order) },
          { label: "Delete permanently", icon: Trash2, destructive: true, onClick: () => commands.purge(order) },
        ]
      : [{ label: "Move to Trash", icon: Trash2, destructive: true, onClick: () => commands.trash(order) }];

  return (
    <header className="space-y-4">
      {/* On desktop the toolbar's breadcrumb (Orders › Order) is the way back. */}
      {variant === "page" && (
        <div className="md:hidden">
          <BackLink onClick={onClose} label="Back to Orders" />
        </div>
      )}

      {deleted && (
        <Alert
          variant="danger"
          title="This order is in Trash"
          action={
            perms.trash ? (
              <Button variant="outline" size="sm" onClick={() => commands.restore(order)} loading={commands.pending.restore}>
                <RotateCcw size={14} /> Restore
              </Button>
            ) : undefined
          }
        >
          Moved on {formatStoreDateTime(order.deletedAt!)}. Restore it to make changes.
        </Alert>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Heading className="text-[26px] font-semibold tracking-tight text-fg">{order.orderNumber}</Heading>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
            <span>Placed {formatStoreDateTime(order.createdAt)}</span>
            <PaymentBadges method={order.paymentMethod} status={order.paymentStatus} layout="inline" />
            {order.exchangeOf && (
              <span>
                Replacement for{" "}
                <Link href={`/admin/orders/${order.exchangeOf.order.id}`} className="font-medium text-info-700 hover:underline">
                  {order.exchangeOf.order.orderNumber}
                </Link>
              </span>
            )}
          </div>
        </div>
        {variant === "drawer" && (
          <span className="hidden items-center gap-1.5 text-[11px] text-ink-400 sm:flex" aria-hidden="true">
            <kbd className="rounded border border-line px-1 py-0.5 font-sans">↑</kbd>
            <kbd className="rounded border border-line px-1 py-0.5 font-sans">↓</kbd> next / previous ·
            <kbd className="rounded border border-line px-1 py-0.5 font-sans">Esc</kbd> close
          </span>
        )}
      </div>

      {!deleted && <OrderProgress order={order} />}

      <div className="flex flex-wrap items-center gap-2" data-testid="order-actions">
        {next && (
          <Button size="sm" onClick={() => commands.requestStatusChange([order], next)}>
            Mark as {orderStatusLabel(next)} <ArrowRight size={14} />
          </Button>
        )}
        {allowed.length > 0 && (
          <>
            <Button ref={statusRef} variant="outline" size="sm" onClick={() => setStatusOpen((v) => !v)} aria-haspopup="menu" aria-expanded={statusOpen}>
              Change status <ChevronDown size={13} aria-hidden="true" />
            </Button>
            <Popover open={statusOpen} onClose={() => setStatusOpen(false)} anchorRef={statusRef} align="start" className="w-64 p-1.5">
              <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                From {orderStatusLabel(order.status)} to
              </p>
              <div role="menu" aria-label={`Move ${order.orderNumber} to`}>
                {allowed.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setStatusOpen(false);
                      commands.requestStatusChange([order], s);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-900/[0.04]"
                  >
                    <OrderStatusIcon status={s} size={14} className="text-ink-400" />
                    {orderStatusLabel(s)}
                  </button>
                ))}
              </div>
              <p className="border-t border-line-subtle px-2.5 pb-1 pt-2 text-[11px] text-ink-400">Only moves the order workflow allows are listed.</p>
            </Popover>
          </>
        )}
        <Link href={`/admin/orders/${order.id}/invoice`} target="_blank" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <FileText size={14} /> Invoice
        </Link>
        {!deleted && (
          <Button variant="outline" size="sm" onClick={() => commands.printLabels([order.id])}>
            <Printer size={14} /> Label
          </Button>
        )}
        {variant === "drawer" && (
          <Link href={`/admin/orders/${order.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ExternalLink size={14} /> Full page
          </Link>
        )}
        {menu.length > 0 && (
          <>
            <IconButton ref={menuRef} variant="outline" aria-label="More order actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <MoreHorizontal size={16} />
            </IconButton>
            <DropdownMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} items={menu} align="end" />
          </>
        )}
      </div>
    </header>
  );
}
