"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveX, Download, PhoneCall, Plus, RefreshCw, SearchX, ShoppingBag } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { toast } from "@/components/ui/toast";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { OrderDetailPanel } from "@/components/admin/order-detail-panel";
import { OrdersFilterBar } from "@/components/admin/orders/orders-filter-bar";
import { OrdersList } from "@/components/admin/orders/orders-list";
import { OrdersBulkBar } from "@/components/admin/orders/orders-bulk-bar";
import { orderKeys, prefetchOrder, useOrderPermissions } from "@/components/admin/orders/order-domain";
import { useOrderCommands } from "@/components/admin/orders/use-order-commands";
import { useOrdersListState } from "@/components/admin/orders/use-orders-list-state";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { getErrorMessage } from "@/lib/api-client";
import { formatCount, formatStoreTime } from "@/lib/format";
import { rememberOrdersListUrl } from "@/lib/admin/orders-return";

/** The Orders workspace: a live summary line, a filterable list (status tabs, work-queue views), bulk actions and the order
 * drawer. Today's totals live on Home; each view is the same queue object the server counts. Composition only —
 * state lives in useOrdersListState, every command in useOrderCommands, every rule in @clothing-brand/shared / the API. */
export default function OrdersPage() {
  const state = useOrdersListState();
  const perms = useOrderPermissions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The drawer's order lives in the URL (`open`), so a refresh or a shared link reopens it.
  const drawerOrderId = state.openOrderId;
  const setDrawerOrderId = (id: string | null) => state.openOrder(id);
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
  // Pages reached from here (Print labels, an order's page, Create order) return to this exact list.
  const searchParams = useSearchParams().toString();
  useEffect(() => rememberOrdersListUrl(`/admin/orders${searchParams ? `?${searchParams}` : ""}`), [searchParams]);
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: [...orderKeys.list, { page, pageSize, ...filterParams }],
    queryFn: ({ signal }) => adminOrdersApi.listOrders({ page, pageSize, ...filterParams }, { signal }),
    placeholderData: (prev) => prev,
    enabled: state.pageSizeReady,
    // Courier statuses change server-side (webhook, sync cron) — poll so the list stays current. Paused in background tabs.
    refetchInterval: 30_000,
  });
  const { data: stats, isError: statsError } = useQuery({ queryKey: orderKeys.stats, queryFn: adminOrdersApi.getOrderStats, refetchInterval: 60_000 });
  const [exporting, setExporting] = useState(false);
  const [takingNext, setTakingNext] = useState(false);

  async function takeNext() {
    setTakingNext(true);
    try {
      const { next } = await adminOrdersApi.takeNextConfirmation();
      if (next) state.openOrder(next.orderId);
      else toast.info("Nobody is waiting for a call right now");
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't take the next call"));
    } finally {
      setTakingNext(false);
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      await adminOrdersApi.downloadOrdersCsv(filterParams);
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't export the orders"));
    } finally {
      setExporting(false);
    }
  }

  // A selection only ever refers to rows on screen: a new page/filter clears it, so a bulk action can't hit hidden rows.
  const viewKey = JSON.stringify([page, pageSize, filterParams]);
  useEffect(() => setSelected(new Set()), [viewKey]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const selectedOrders = useMemo(() => items.filter((o) => selected.has(o.id)), [items, selected]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  // Rows that leave the current view (booked out of "Ready to book", moved to another status) can empty this page. Land
  // on the last page that still has rows — never page 1 — and say so.
  const [movedFrom, setMovedFrom] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!data || isFetching || data.items.length > 0 || data.total === 0 || page <= 1) return;
    const last = Math.max(1, Math.ceil(data.total / pageSize));
    if (last >= page) return;
    setMovedFrom({ from: page, to: last });
    state.replacePage(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isFetching, page, pageSize]);
  useEffect(() => {
    if (movedFrom && page !== movedFrom.to) setMovedFrom(null);
  }, [page, movedFrom]);

  // Drawer prev/next steps through the rows currently on screen.
  const drawerIndex = drawerOrderId ? items.findIndex((o) => o.id === drawerOrderId) : -1;
  const [stepAnnouncement, setStepAnnouncement] = useState("");
  const stepDrawer = (offset: number) => {
    const next = drawerIndex === -1 ? undefined : items[drawerIndex + offset];
    if (!next) return;
    state.openOrder(next.id, { step: true });
    setStepAnnouncement(`Order ${next.orderNumber} loaded, ${drawerIndex + offset + 1} of ${items.length}`);
  };
  // ↑/↓ land on an order that's already loaded: warm the neighbours of the one in the drawer.
  const queryClient = useQueryClient();
  const prevId = drawerIndex > 0 ? items[drawerIndex - 1]?.id : undefined;
  const nextId = drawerIndex >= 0 ? items[drawerIndex + 1]?.id : undefined;
  useEffect(() => {
    if (prevId) prefetchOrder(queryClient, prevId);
    if (nextId) prefetchOrder(queryClient, nextId);
  }, [queryClient, prevId, nextId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));

  // A failed load must never read as "no orders": with nothing cached it replaces the list; with an older page cached
  // (a failed 30s poll), the rows stay and a marker above them says they may be out of date.
  const empty = isError ? (
    <ErrorState
      title="Couldn't load orders"
      description={getErrorMessage(error, "The server didn't respond — check the connection, then try again.")}
      onRetry={() => void refetch()}
    />
  ) : state.view === "trash" ? (
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
        descriptionOnPhone
        description={
          stats
            ? `${formatCount(stats.pending)} pending or confirmed · ${formatCount(stats.needsAttention)} need attention · ${formatCount(stats.todayOrders)} placed today`
            : statsError
              ? "Summary unavailable right now — it retries every minute."
              : "Loading today's summary…"
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {perms.exportCsv && (
              <Button
                variant="outline"
                loading={exporting}
                onClick={exportCsv}
                title="Export the current filtered list as CSV"
                aria-label="Export CSV"
                className="max-sm:w-10 max-sm:px-0"
              >
                {!exporting && <Download size={16} />} <span className="max-sm:hidden">Export CSV</span>
              </Button>
            )}
            {perms.manage && (
              <Link href="/admin/orders/new" className={buttonVariants({ variant: "primary" })}>
                <Plus size={16} /> Create order
              </Link>
            )}
          </div>
        }
      />

      <ModuleTabs />

      <OrdersFilterBar ref={searchRef} state={state} stats={stats} canSeeTrash={perms.trash} />

      {/* Call now (phase 3): one operator per order — "Take next call" claims the next one for 15 minutes and opens it. */}
      {state.queue === "callNow" && perms.manage && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-subtle bg-surface px-4 py-3">
          <p className="text-sm text-fg-muted">Callbacks that are due come first, then the oldest orders. A taken order is yours for 15 minutes.</p>
          <Button loading={takingNext} onClick={takeNext} data-testid="take-next-call" className="min-h-[44px]">
            {!takingNext && <PhoneCall size={16} />} Take next call
          </Button>
        </div>
      )}

      {isError && data && (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-sm text-warning-700">
          <span>Couldn&apos;t refresh — showing orders as of {formatStoreTime(new Date(dataUpdatedAt))}.</span>
          <Button variant="outline" size="sm" loading={isFetching} onClick={() => void refetch()}>
            {!isFetching && <RefreshCw size={13} />} Retry
          </Button>
        </div>
      )}
      {/* Screen readers hear the result size after every search/filter change (the visible count is per layout). */}
      <p className="sr-only" aria-live="polite">
        {data ? `${formatCount(data.total)} ${data.total === 1 ? "order" : "orders"}` : ""}
      </p>
      {movedFrom && (
        <p role="status" data-testid="orders-page-moved" className="mt-4 rounded-xl border border-line-subtle bg-surface px-3.5 py-2.5 text-sm text-fg-muted">
          Page {movedFrom.from} has no orders left in this view — showing page {movedFrom.to}, the last one.
        </p>
      )}

      <OrdersList
        items={items}
        total={data?.total}
        isLoading={isLoading || !state.pageSizeReady}
        density={state.density}
        hiddenColumns={state.hiddenColumns}
        isFetching={isFetching}
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

      {/* The work list leaves finished orders out; say where they went (a search still finds every order). */}
      {filterParams.scope === "active" && (
        <p className="mt-4 text-center text-sm text-fg-muted" data-testid="orders-history-hint">
          Finished orders — delivered and settled, or cancelled with nothing left to do — are in{" "}
          <Link href="/admin/orders/history" className="font-medium text-accent underline-offset-2 hover:underline">
            Order history
          </Link>
          .
        </p>
      )}

      {/* Room for the floating bulk bar, so it never covers the last row or the pagination. */}
      {selectedOrders.length > 0 && <div className="h-28 sm:h-20" aria-hidden="true" />}

      <OrdersBulkBar orders={selectedOrders} view={state.view} commands={commands} perms={perms} onClear={() => setSelected(new Set())} />

      <Drawer
        open={Boolean(drawerOrderId)}
        onClose={() => {
          setDrawerOrderId(null);
          setStepAnnouncement("");
        }}
        title="Order details"
        widthClassName="max-w-3xl"
        onPrev={() => stepDrawer(-1)}
        onNext={() => stepDrawer(1)}
        prevDisabled={drawerIndex <= 0}
        nextDisabled={drawerIndex === -1 || drawerIndex >= items.length - 1}
        navLabel={drawerIndex !== -1 ? `${drawerIndex + 1} of ${items.length}` : undefined}
        navItemLabel="order"
        announcement={stepAnnouncement}
      >
        {drawerOrderId && <OrderDetailPanel orderId={drawerOrderId} onClose={() => setDrawerOrderId(null)} variant="drawer" />}
      </Drawer>

      {commands.dialogs}
    </div>
  );
}
