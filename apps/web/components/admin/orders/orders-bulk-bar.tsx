"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Printer, RefreshCw, RotateCcw, ShieldCheck, Trash2, Truck, X } from "lucide-react";
import type { AdminOrderListItem, OrderStatus } from "@clothing-brand/shared";
import { BulkActionBar } from "@/components/ui/bulk-action-bar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Popover } from "@/components/ui/popover";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import { orderStatusLabel } from "@/lib/format";
import { ORDER_STATUSES, nextStatusesFor, type OrderPermissions } from "./order-domain";
import type { OrderCommands } from "./use-order-commands";

/** Bulk actions for the selected orders, on the shared BulkActionBar. Every action reports per-order results. */
export function OrdersBulkBar({
  orders,
  view,
  commands,
  perms,
  onClear,
}: {
  orders: AdminOrderListItem[];
  view: "active" | "trash";
  commands: OrderCommands;
  perms: OrderPermissions;
  onClear: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const statusRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  // Only statuses at least one selected order may legally move to, with how many can.
  const reachable = useMemo(() => {
    const counts = new Map<OrderStatus, number>();
    for (const o of orders) for (const s of nextStatusesFor(o.status, perms)) counts.set(s, (counts.get(s) ?? 0) + 1);
    return ORDER_STATUSES.filter((s) => counts.has(s)).map((s) => ({ status: s, count: counts.get(s)! }));
  }, [orders, perms]);

  const more: DropdownMenuItem[] = [
    ...(perms.courier ? [{ label: "Sync courier status", icon: RefreshCw, onClick: () => commands.bulkSync(orders), disabled: commands.pending.sync }] : []),
    ...(perms.manage && perms.courierConfigured ? [{ label: "Check delivery score", icon: ShieldCheck, onClick: () => commands.checkDeliveryScore(orders), disabled: commands.pending.score }] : []),
  ];

  return (
    <BulkActionBar count={orders.length} itemLabel="orders">
      {view === "active" ? (
        <>
          {perms.manage && (
            <>
              <Button ref={statusRef} variant="outline" size="sm" onClick={() => setStatusOpen((v) => !v)} aria-haspopup="menu" aria-expanded={statusOpen} disabled={reachable.length === 0}>
                Set status <ChevronDown size={13} aria-hidden="true" />
              </Button>
              <Popover open={statusOpen} onClose={() => setStatusOpen(false)} anchorRef={statusRef} align="start" className="w-64 p-1.5">
                <div role="menu" aria-label="Move selected orders to">
                  {reachable.map(({ status, count }) => (
                    <button
                      key={status}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStatusOpen(false);
                        commands.requestStatusChange(orders, status);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-700 hover:bg-ink-900/[0.04]"
                    >
                      <OrderStatusIcon status={status} size={14} className="text-ink-400" />
                      <span className="flex-1">{orderStatusLabel(status)}</span>
                      <span className="text-xs tabular-nums text-ink-400">
                        {count} of {orders.length}
                      </span>
                    </button>
                  ))}
                </div>
              </Popover>
            </>
          )}
          {perms.courier && (
            <Button variant="outline" size="sm" loading={commands.pending.book} onClick={() => commands.bulkBook(orders)}>
              <Truck size={14} /> Book courier
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => commands.printLabels(orders.map((o) => o.id))}>
            <Printer size={14} /> Print labels
          </Button>
          {more.length > 0 && (
            <>
              <IconButton ref={moreRef} variant="outline" size="md" aria-label="More bulk actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                <MoreHorizontal size={16} />
              </IconButton>
              <DropdownMenu open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} items={more} align="end" />
            </>
          )}
          {perms.trash && (
            <Button variant="destructive" size="sm" loading={commands.pending.trash} onClick={() => commands.bulkTrash(orders)}>
              <Trash2 size={14} /> Trash
            </Button>
          )}
        </>
      ) : perms.trash ? (
        <>
          <Button variant="outline" size="sm" loading={commands.pending.restore} onClick={() => commands.bulkRestore(orders)}>
            <RotateCcw size={14} /> Restore
          </Button>
          <Button variant="destructive" size="sm" loading={commands.pending.purge} onClick={() => commands.bulkPurge(orders)}>
            <Trash2 size={14} /> Delete forever
          </Button>
        </>
      ) : null}
      <IconButton onClick={onClear} aria-label="Clear selection" className="ml-auto">
        <X size={16} />
      </IconButton>
    </BulkActionBar>
  );
}
