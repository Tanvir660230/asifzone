"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Archive, Download, SearchX, SlidersHorizontal, X } from "lucide-react";
import { paymentMethodEnum, paymentStatusEnum, type OrderStatus, type PaymentMethod, type PaymentStatus } from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Popover } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/admin/page-header";
import { ModuleTabs } from "@/components/admin/module-tabs";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { OrderDetailPanel } from "@/components/admin/order-detail-panel";
import { OrdersList } from "@/components/admin/orders/orders-list";
import { OrdersDisplayMenu } from "@/components/admin/orders/orders-display-menu";
import { CountBadge, tabBase, tabOff, tabOn } from "@/components/admin/orders/orders-filter-bar";
import { paymentMethodLabel } from "@/components/admin/orders/order-filters";
import { orderKeys, useOrderPermissions } from "@/components/admin/orders/order-domain";
import { useOrderCommands } from "@/components/admin/orders/use-order-commands";
import { useOrdersListState } from "@/components/admin/orders/use-orders-list-state";
import * as adminOrdersApi from "@/lib/api/admin-orders";
import { getErrorMessage } from "@/lib/api-client";
import { formatCount, orderStatusShortLabel, paymentStatusLabel } from "@/lib/format";
import { rememberOrdersListUrl } from "@/lib/admin/orders-return";
import { cn } from "@/lib/utils";

/** The statuses a finished order can end in. */
const FINISHED_STATUSES: OrderStatus[] = ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "RETURNED", "REFUNDED"];

/**
 * Order history: every finished order — delivered and settled, or cancelled / returned with the parcel back, inspected and
 * nothing owed either way — out of the daily work list. The same orders, not a copy: an order arrives here when its last
 * piece of work is done and goes back to Orders by itself if something new comes up (a refund request, a charge to
 * review). Read-only here; corrections happen on the order, through refunds, returns and payments.
 */
export default function OrderHistoryPage() {
  const state = useOrdersListState({ mode: "history" });
  const perms = useOrderPermissions();
  const commands = useOrderCommands({ onOpenOrder: (id) => state.openOrder(id), onPurged: () => state.openOrder(null) });
  const searchRef = useRef<HTMLInputElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { page, pageSize, filterParams, more } = state;

  const searchParams = useSearchParams().toString();
  useEffect(() => rememberOrdersListUrl(`/admin/orders/history${searchParams ? `?${searchParams}` : ""}`), [searchParams]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: [...orderKeys.list, { page, pageSize, ...filterParams }],
    queryFn: ({ signal }) => adminOrdersApi.listOrders({ page, pageSize, ...filterParams }, { signal }),
    placeholderData: (prev) => prev,
    enabled: state.pageSizeReady,
  });
  const { data: stats } = useQuery({ queryKey: orderKeys.stats, queryFn: adminOrdersApi.getOrderStats, refetchInterval: 60_000 });
  const counts = stats?.historyStatusCounts;
  const finishedTotal = counts ? FINISHED_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0) : undefined;

  const items = useMemo(() => data?.items ?? [], [data]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const drawerOrderId = state.openOrderId;
  const drawerIndex = drawerOrderId ? items.findIndex((o) => o.id === drawerOrderId) : -1;
  const step = (offset: number) => {
    const next = drawerIndex === -1 ? undefined : items[drawerIndex + offset];
    if (next) state.openOrder(next.id, { step: true });
  };
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
  // Only these filters live behind the Filters button here (search and status are on the bar).
  const filterCount = [more.dateFrom, more.dateTo, more.paymentMethod, more.paymentStatus].filter(Boolean).length;

  const empty = isError ? (
    <ErrorState title="Couldn't load order history" description={getErrorMessage(error, "The server didn't respond — check the connection, then try again.")} onRetry={() => void refetch()} />
  ) : state.hasFilters ? (
    <EmptyState
      icon={SearchX}
      title="No finished orders match"
      description="An order still being worked on — waiting for payment, a parcel coming back, a refund — is on the Orders list."
      action={
        <Button variant="outline" size="sm" onClick={state.clearAll}>
          Clear all filters
        </Button>
      }
    />
  ) : (
    <EmptyState icon={Archive} title="No finished orders yet" description="Orders land here once they're delivered and settled, or cancelled with nothing left to do." />
  );

  return (
    <div>
      <PageHeader
        title="Order history"
        descriptionOnPhone
        description="Finished orders, kept out of the daily list: delivered and settled, or cancelled and returned with nothing left to do."
        action={
          perms.exportCsv ? (
            <Button variant="outline" loading={exporting} onClick={exportCsv} title="Export these finished orders as CSV" aria-label="Export CSV" className="max-sm:w-10 max-sm:px-0">
              {!exporting && <Download size={16} />} <span className="max-sm:hidden">Export CSV</span>
            </Button>
          ) : undefined
        }
      />

      <ModuleTabs />

      <div className="z-raised -mx-4 space-y-2.5 border-b border-line bg-canvas px-4 pb-3 pt-1 sm:sticky sm:top-chrome sm:-mx-page sm:space-y-3 sm:px-page sm:pt-3">
        <div className="flex flex-nowrap items-center gap-2 sm:flex-wrap sm:gap-2.5">
          <SearchInput
            ref={searchRef}
            wrapperClassName="min-w-0 flex-1 sm:w-80 sm:flex-none"
            placeholder="Order, phone or tracking code"
            aria-label="Search order history"
            value={state.search}
            onChange={state.setSearch}
          />
          <Button ref={filtersRef} variant="outline" size="sm" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen} aria-haspopup="dialog">
            <SlidersHorizontal size={14} /> Filters
            {filterCount > 0 && <span className="rounded-full bg-accent px-1.5 text-xs font-semibold leading-[18px] text-accent-fg">{filterCount}</span>}
          </Button>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <OrdersDisplayMenu state={state} />
            <PageSizeSelect value={state.pageSize} onChange={state.setPageSize} />
          </div>
          <Popover open={filtersOpen} onClose={() => setFiltersOpen(false)} anchorRef={filtersRef} align="start" aria-label="Filters" sheetOnPhone className="w-[min(92vw,520px)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Placed from" htmlFor="h-date-from">
                <Input id="h-date-from" type="date" value={more.dateFrom} onChange={(e) => more.setDateFrom(e.target.value)} />
              </Field>
              <Field label="Placed to" htmlFor="h-date-to">
                <Input id="h-date-to" type="date" value={more.dateTo} onChange={(e) => more.setDateTo(e.target.value)} />
              </Field>
              <Field label="Payment method" htmlFor="h-payment-method">
                <Select id="h-payment-method" value={more.paymentMethod} onChange={(e) => more.setPaymentMethod(e.target.value as PaymentMethod | "")}>
                  <option value="">Any</option>
                  {paymentMethodEnum.options.map((m) => (
                    <option key={m} value={m}>
                      {paymentMethodLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Payment status" htmlFor="h-payment-status">
                <Select id="h-payment-status" value={more.paymentStatus} onChange={(e) => more.setPaymentStatus(e.target.value as PaymentStatus | "")}>
                  <option value="">Any</option>
                  {paymentStatusEnum.options.map((s) => (
                    <option key={s} value={s}>
                      {paymentStatusLabel(s)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-subtle pt-3 sm:hidden">
              <PageSizeSelect value={state.pageSize} onChange={state.setPageSize} />
            </div>
            {filterCount > 0 && (
              <div className="mt-3 flex justify-end border-t border-line-subtle pt-3">
                <Button variant="outline" size="sm" onClick={more.clear}>
                  <X size={14} /> Clear these filters
                </Button>
              </div>
            )}
          </Popover>
        </div>

        <HScrollShadow className="overflow-x-auto">
          <div role="group" aria-label="Filter by status (select several)" className="flex flex-nowrap items-center gap-1.5 py-0.5">
            <button type="button" aria-pressed={state.statuses.length === 0} onClick={state.clearStatuses} className={cn(tabBase, state.statuses.length === 0 ? tabOn : tabOff)}>
              All <CountBadge value={finishedTotal} />
            </button>
            {FINISHED_STATUSES.map((s) => {
              const on = state.statuses.includes(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => state.toggleStatus(s)} className={cn(tabBase, on ? tabOn : tabOff)}>
                  {orderStatusShortLabel(s)}
                  <CountBadge value={counts?.[s]} />
                </button>
              );
            })}
          </div>
        </HScrollShadow>

        {state.chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {state.chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.label}`}
                className="flex min-h-[28px] items-center gap-1 rounded-full bg-ink-100 py-1 pl-2.5 pr-1.5 text-xs font-medium text-ink-700 transition-colors duration-fast ease-smooth hover:bg-ink-200"
              >
                {chip.label}
                <X size={12} className="text-fg-subtle" aria-hidden="true" />
              </button>
            ))}
            <button type="button" onClick={state.clearAll} className="px-1 text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline">
              Clear all
            </button>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {data ? `${formatCount(data.total)} ${data.total === 1 ? "finished order" : "finished orders"}` : ""}
      </p>

      <OrdersList
        readOnly
        items={items}
        total={data?.total}
        isLoading={isLoading || !state.pageSizeReady}
        isFetching={isFetching}
        density={state.density}
        hiddenColumns={state.hiddenColumns}
        selected={new Set()}
        onToggle={() => undefined}
        onToggleAll={() => undefined}
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        onSort={state.toggleSort}
        onOpen={(id) => state.openOrder(id)}
        commands={commands}
        perms={perms}
        empty={empty}
      />

      <Pagination page={page} totalPages={totalPages} onChange={state.setPage} />

      <Drawer
        open={Boolean(drawerOrderId)}
        onClose={() => state.openOrder(null)}
        title="Order details"
        widthClassName="max-w-3xl"
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        prevDisabled={drawerIndex <= 0}
        nextDisabled={drawerIndex === -1 || drawerIndex >= items.length - 1}
        navLabel={drawerIndex !== -1 ? `${drawerIndex + 1} of ${items.length}` : undefined}
        navItemLabel="order"
      >
        {drawerOrderId && <OrderDetailPanel orderId={drawerOrderId} onClose={() => state.openOrder(null)} variant="drawer" />}
      </Drawer>

      {commands.dialogs}
    </div>
  );
}
