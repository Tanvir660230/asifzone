"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArchiveX, Download, Plus, SearchX, ShoppingBag } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { PageHeader } from "@/components/admin/page-header";
import { OrdersSubNav } from "@/components/admin/orders-subnav";
import { OrderDetailPanel } from "@/components/admin/order-detail-panel";
import { OrdersSummary } from "@/components/admin/orders/orders-summary";
import { OrdersFilterBar } from "@/components/admin/orders/orders-filter-bar";
import { OrdersList } from "@/components/admin/orders/orders-list";
import { OrdersBulkBar } from "@/components/admin/orders/orders-bulk-bar";
import { orderKeys, useOrderPermissions } from "@/components/admin/orders/order-domain";
import { useOrderCommands } from "@/components/admin/orders/use-order-commands";
import { useOrdersListState } from "@/components/admin/orders/use-orders-list-state";
import * as adminOrdersApi from "@/lib/api/admin-orders";

/** The Orders workspace: operational summary, filterable list, bulk actions and the order drawer. Composition only —
 * state lives in useOrdersListState, every command in useOrderCommands, every rule in @clothing-brand/shared / the API. */
export default function OrdersPage() {
  const state = useOrdersListState();
  const perms = useOrderPermissions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const commands = useOrderCommands({ onOpenOrder: setDrawerOrderId, onPurged: () => setDrawerOrderId(null) });

  // "/" or ⌘K focuses search — unless the admin is already typing somewhere.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.tagName === "SELECT" || t?.isContentEditable;
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const { page, pageSize, filterParams } = state;
  const { data, isLoading } = useQuery({
    queryKey: [...orderKeys.list, { page, pageSize, ...filterParams }],
    queryFn: () => adminOrdersApi.listOrders({ page, pageSize, ...filterParams }),
    placeholderData: (prev) => prev,
    // Courier statuses change server-side (webhook, sync cron) — poll so the list stays current. Paused in background tabs.
    refetchInterval: 30_000,
  });
  const { data: stats } = useQuery({ queryKey: orderKeys.stats, queryFn: adminOrdersApi.getOrderStats, refetchInterval: 60_000 });

  // A selection only ever refers to rows on screen: a new page/filter clears it, so a bulk action can't hit hidden rows.
  const viewKey = JSON.stringify([page, pageSize, filterParams]);
  useEffect(() => setSelected(new Set()), [viewKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const selectedOrders = useMemo(() => items.filter((o) => selected.has(o.id)), [items, selected]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  // Drawer prev/next steps through the rows currently on screen.
  const drawerIndex = drawerOrderId ? items.findIndex((o) => o.id === drawerOrderId) : -1;
  const stepDrawer = (offset: number) => {
    const next = drawerIndex === -1 ? undefined : items[drawerIndex + offset];
    if (next) setDrawerOrderId(next.id);
  };

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));

  const empty =
    state.view === "trash" ? (
      <EmptyState icon={ArchiveX} title="Trash is empty" description="Orders moved to Trash appear here." />
    ) : state.hasFilters ? (
      <EmptyState
        icon={SearchX}
        title="No orders match these filters"
        description="Adjust or clear the search and filters."
        action={
          <Button variant="outline" size="sm" onClick={state.clearAll}>
            Clear all filters
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={ShoppingBag}
        title="No orders yet"
        description="Orders appear here as customers check out, or create one for a phone order."
        action={
          perms.manage ? (
            <Link href="/admin/orders/new" className={buttonVariants({ size: "sm" })}>
              <Plus size={14} /> Create order
            </Link>
          ) : undefined
        }
      />
    );

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Confirm, fulfil, ship and settle every order from one place."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {perms.exportCsv && (
              <a href={adminOrdersApi.downloadOrdersCsvUrl(filterParams)} className={buttonVariants({ variant: "outline" })} title="Export the current filtered list as CSV">
                <Download size={16} /> Export CSV
              </a>
            )}
            {perms.manage && (
              <Link href="/admin/orders/new" className={buttonVariants({ variant: "primary" })}>
                <Plus size={16} /> Create order
              </Link>
            )}
          </div>
        }
      />

      <OrdersSubNav />

      {state.view === "active" && <OrdersSummary stats={stats} activeQueue={state.queue} onSelectQueue={state.selectQueue} />}

      <OrdersFilterBar ref={searchRef} state={state} stats={stats} canSeeTrash={perms.trash} />

      <OrdersList
        items={items}
        total={data?.total}
        isLoading={isLoading}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => setSelected(allSelected ? new Set() : new Set(items.map((o) => o.id)))}
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        onSort={state.toggleSort}
        onOpen={setDrawerOrderId}
        commands={commands}
        perms={perms}
        empty={empty}
      />

      <Pagination page={page} totalPages={totalPages} onChange={state.setPage} />

      <OrdersBulkBar orders={selectedOrders} view={state.view} commands={commands} perms={perms} onClear={() => setSelected(new Set())} />

      <Drawer
        open={Boolean(drawerOrderId)}
        onClose={() => setDrawerOrderId(null)}
        title="Order details"
        widthClassName="max-w-3xl"
        onPrev={() => stepDrawer(-1)}
        onNext={() => stepDrawer(1)}
        prevDisabled={drawerIndex <= 0}
        nextDisabled={drawerIndex === -1 || drawerIndex >= items.length - 1}
        navLabel={drawerIndex !== -1 ? `${drawerIndex + 1} of ${items.length}` : undefined}
        navItemLabel="order"
      >
        {drawerOrderId && <OrderDetailPanel orderId={drawerOrderId} onClose={() => setDrawerOrderId(null)} variant="drawer" />}
      </Drawer>

      {commands.dialogs}
    </div>
  );
}
