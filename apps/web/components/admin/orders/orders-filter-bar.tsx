"use client";

import { forwardRef, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  BD_DISTRICTS_BY_DIVISION,
  BD_DIVISIONS,
  COURIER_DELIVERY_STATUSES,
  ORDER_QUEUE_IDS,
  paymentMethodEnum,
  paymentStatusEnum,
  type BdDivision,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@clothing-brand/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/tabs";
import { HScrollShadow } from "@/components/ui/h-scroll-shadow";
import { PageSizeSelect } from "@/components/admin/page-size-select";
import { OrderStatusIcon } from "@/components/admin/order-status-icon";
import type { OrderStats } from "@/lib/api/admin-orders";
import { courierStatusLabel, orderStatusBadgeClass, orderStatusShortLabel, paymentStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ORDER_STATUSES } from "./order-domain";
import { type OrdersListState } from "./use-orders-list-state";
import { ALL_BD_DISTRICTS, ORDER_QUEUE_LABELS, paymentMethodLabel } from "./order-filters";
const FIRST_OUTCOME_STATUS: OrderStatus = "DELIVERED";

function CountBadge({ value, inverted }: { value: number | undefined; inverted?: boolean }) {
  if (value === undefined) return null;
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
        inverted ? "bg-cream-50/25 text-cream-50" : "bg-ink-900/10 text-ink-600",
      )}
    >
      {value}
    </span>
  );
}

const pillBase =
  "flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-[background-color,border-color,opacity,box-shadow] duration-fast ease-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/** Sticky control zone of the Orders list. Stateless: everything lives in useOrdersListState. */
export const OrdersFilterBar = forwardRef<HTMLInputElement, { state: OrdersListState; stats: OrderStats | undefined; canSeeTrash: boolean }>(
  function OrdersFilterBar({ state, stats, canSeeTrash }, searchRef) {
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLButtonElement>(null);
    const { more } = state;
    const statusTotal = stats ? Object.values(stats.statusCounts).reduce((sum, n) => sum + n, 0) : undefined;
    const active = state.view === "active";

    return (
      // Opaque (not glass): it floats over scrolling rows, and translucency let row text bleed through its edge.
      <div className="sticky top-14 z-raised -mx-4 space-y-2.5 border-b border-line-subtle bg-canvas px-4 pb-3 pt-2.5 sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-2.5">
          {canSeeTrash && (
            <SegmentedControl
              aria-label="Orders view"
              value={state.view}
              onChange={state.setView}
              options={[
                { value: "active", label: "Active" },
                { value: "trash", label: "Trash", testId: "orders-view-trash" },
              ]}
            />
          )}
          <SearchInput
            ref={searchRef}
            wrapperClassName="w-full sm:w-72 lg:w-64"
            placeholder="Search order #, name, phone…"
            aria-label="Search orders"
            value={state.search}
            onChange={state.setSearch}
            emptyAdornment={
              <kbd className="hidden rounded border border-line px-1 py-0.5 font-sans text-[10px] font-medium text-ink-300 sm:inline-block">/</kbd>
            }
          />
          <Button
            ref={moreRef}
            variant={more.count > 0 || moreOpen ? "primary" : "outline"}
            size="sm"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal size={14} /> Filters
            {more.count > 0 && <CountBadge value={more.count} inverted />}
          </Button>
          <div className="ml-auto">
            <PageSizeSelect value={state.pageSize} onChange={state.setPageSize} />
          </div>

          <Popover open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreRef} align="start" className="w-[min(92vw,640px)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Payment status" htmlFor="f-payment-status">
                <Select id="f-payment-status" value={more.paymentStatus} onChange={(e) => more.setPaymentStatus(e.target.value as PaymentStatus | "")}>
                  <option value="">Any</option>
                  {paymentStatusEnum.options.map((s) => (
                    <option key={s} value={s}>
                      {paymentStatusLabel(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Payment method" htmlFor="f-payment-method">
                <Select id="f-payment-method" value={more.paymentMethod} onChange={(e) => more.setPaymentMethod(e.target.value as PaymentMethod | "")}>
                  <option value="">Any</option>
                  {paymentMethodEnum.options.map((m) => (
                    <option key={m} value={m}>
                      {paymentMethodLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Courier" htmlFor="f-courier-booked">
                <Select id="f-courier-booked" value={more.courierBooked} onChange={(e) => more.setCourierBooked(e.target.value as "" | "true" | "false")}>
                  <option value="">Any</option>
                  <option value="false">Not booked</option>
                  <option value="true">Booked</option>
                </Select>
              </Field>
              <Field label="Delivery status" htmlFor="f-courier-status">
                <Select id="f-courier-status" value={more.courierStatus} onChange={(e) => more.setCourierStatus(e.target.value)}>
                  <option value="">Any</option>
                  {COURIER_DELIVERY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {courierStatusLabel(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Division" htmlFor="f-division">
                <Select id="f-division" value={more.division} onChange={(e) => more.setDivision(e.target.value as BdDivision | "")}>
                  <option value="">Any</option>
                  {BD_DIVISIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="District" htmlFor="f-district">
                <SearchableSelect
                  id="f-district"
                  value={more.district}
                  onChange={more.setDistrict}
                  options={more.division ? BD_DISTRICTS_BY_DIVISION[more.division] : ALL_BD_DISTRICTS}
                  placeholder="Any district"
                />
              </Field>
              <Field label="Placed from" htmlFor="f-date-from">
                <Input id="f-date-from" type="date" value={more.dateFrom} onChange={(e) => more.setDateFrom(e.target.value)} />
              </Field>
              <Field label="Placed to" htmlFor="f-date-to">
                <Input id="f-date-to" type="date" value={more.dateTo} onChange={(e) => more.setDateTo(e.target.value)} />
              </Field>
            </div>
            {more.count > 0 && (
              <div className="mt-3 flex justify-end border-t border-line-subtle pt-3">
                <Button variant="outline" size="sm" onClick={more.clear}>
                  <X size={14} /> Clear these filters
                </Button>
              </div>
            )}
          </Popover>
        </div>

        {active && (
          <>
            {/* Status: multi-select toggles (one status → `status`, several → `statusIn`). A divider separates in-flight
                statuses from outcomes. */}
            <HScrollShadow className="overflow-x-auto">
              <div role="group" aria-label="Filter by status (select several)" className="flex flex-nowrap items-center gap-1.5 py-0.5">
                <button
                  type="button"
                  aria-pressed={state.statuses.length === 0 && !state.queue}
                  onClick={state.clearStatuses}
                  className={cn(
                    pillBase,
                    state.statuses.length === 0 && !state.queue ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line text-ink-600 hover:border-ink-400",
                  )}
                >
                  All <CountBadge value={statusTotal} inverted={state.statuses.length === 0 && !state.queue} />
                </button>
                {ORDER_STATUSES.map((s) => {
                  const on = state.statuses.includes(s);
                  return (
                    <span key={s} className="flex shrink-0 items-center gap-1.5">
                      {s === FIRST_OUTCOME_STATUS && <span className="mx-0.5 h-4 w-px bg-line" aria-hidden="true" />}
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => state.toggleStatus(s)}
                        className={cn(pillBase, orderStatusBadgeClass(s), on ? "border-ink-900 ring-1 ring-ink-900" : "border-transparent opacity-70 hover:opacity-100")}
                      >
                        <OrderStatusIcon status={s} size={12} />
                        {orderStatusShortLabel(s)}
                        <CountBadge value={stats?.statusCounts[s]} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </HScrollShadow>

            <HScrollShadow className="overflow-x-auto">
              <div role="group" aria-label="Quick filters" className="flex flex-nowrap items-center gap-1.5 py-0.5">
                <span className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Quick</span>
                {ORDER_QUEUE_IDS.map((id) => {
                  const on = state.queue === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => state.selectQueue(id)}
                      className={cn(pillBase, on ? "border-ink-900 bg-ink-900 text-cream-50" : "border-line text-ink-600 hover:border-ink-400 hover:bg-ink-900/[0.03]")}
                    >
                      {ORDER_QUEUE_LABELS[id]}
                      <CountBadge value={stats?.queueCounts?.[id]} inverted={on} />
                    </button>
                  );
                })}
              </div>
            </HScrollShadow>
          </>
        )}

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
                <X size={12} className="text-ink-400" aria-hidden="true" />
              </button>
            ))}
            <button type="button" onClick={state.clearAll} className="px-1 text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline">
              Clear all
            </button>
          </div>
        )}
      </div>
    );
  },
);
