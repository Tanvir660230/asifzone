"use client";

import { useEffect, useMemo, useState } from "react";
import { ORDER_QUEUE_FILTERS, type BdDivision, type OrderQueueId, type OrderStatus, type PaymentMethod, type PaymentStatus } from "@clothing-brand/shared";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { AdminOrderListParams } from "@/lib/api/admin-orders";
import { activeFilterChips, filterField, type FilterValues } from "@/lib/admin/filters";
import { parseUrlState, type UrlField } from "@/lib/url-state";
import { ORDER_FILTERS, ORDER_FILTER_URL_ALIASES } from "./order-filters";

export { ORDER_QUEUE_LABELS } from "./order-filters";

/** The two filters other screens deep-link into (the dashboard's Action Center, tiles) — read with the URL-state parser
 * from the Orders filter definitions, so a bad value is ignored exactly like the controls would. */
const DEEP_LINK_SCHEMA = {
  "f.queue": filterField(ORDER_FILTERS.find((f) => f.key === "f.queue")!) as UrlField<string>,
  "f.status": filterField(ORDER_FILTERS.find((f) => f.key === "f.status")!) as UrlField<string[]>,
};

export type SortColumn = NonNullable<AdminOrderListParams["sortBy"]>;
export type OrdersView = "active" | "trash";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/**
 * All of the Orders list's view state in one place: view (active/trash), search, multi-status, the quick-filter queue,
 * the "more filters" set, sort and paging — and what they become as list-query params and removable chips. A queue is a
 * preset from @clothing-brand/shared (ORDER_QUEUE_FILTERS), the same object the server counts for its badge.
 */
export function useOrdersListState() {
  const [view, setViewRaw] = useState<OrdersView>("active");
  const [search, setSearchRaw] = useState("");
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [queue, setQueueRaw] = useState<OrderQueueId | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [courierBooked, setCourierBooked] = useState<"" | "true" | "false">("");
  const [courierStatus, setCourierStatus] = useState("");
  const [division, setDivision] = useState<BdDivision | "">("");
  const [district, setDistrict] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState<SortColumn | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(20);
  const debouncedSearch = useDebouncedValue(search, 350);

  // Any filter change returns to page 1 — wrap each setter once instead of repeating setPage(1) at every call site.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  function toggleStatus(status: OrderStatus) {
    setStatuses((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
    setQueueRaw(null);
    setPage(1);
  }
  function selectQueue(id: OrderQueueId | null) {
    setQueueRaw((prev) => (prev === id ? null : id));
    // A queue is a complete preset (some imply a status) — it replaces the status selection rather than intersecting it.
    setStatuses([]);
    setViewRaw("active");
    setPage(1);
  }
  function clearMoreFilters() {
    setPaymentStatus("");
    setPaymentMethod("");
    setCourierBooked("");
    setCourierStatus("");
    setDivision("");
    setDistrict("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }
  // Deep links from elsewhere (the dashboard's Action Center, tiles): ?queue=<OrderQueueId> or ?status=A,B (also their
  // URL-state names ?f.queue= / ?f.status=). Read once on mount from window.location rather than useSearchParams, which
  // would force a Suspense boundary around the page. A queue wins over statuses, as when picked by hand.
  useEffect(() => {
    const links = parseUrlState(DEEP_LINK_SCHEMA, new URLSearchParams(window.location.search), ORDER_FILTER_URL_ALIASES);
    if (links["f.queue"]) {
      setQueueRaw(links["f.queue"] as OrderQueueId);
      return;
    }
    if (links["f.status"].length) setStatuses(links["f.status"] as OrderStatus[]);
  }, []);

  function clearAll() {
    setSearchRaw("");
    setStatuses([]);
    setQueueRaw(null);
    clearMoreFilters();
  }
  function toggleSort(column: SortColumn) {
    if (sortBy === column) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(column);
      setSortDir("asc");
    }
    setPage(1);
  }

  const filterParams = useMemo<AdminOrderListParams>(() => {
    const base: AdminOrderListParams = {
      search: debouncedSearch || undefined,
      deleted: view === "trash",
      ...(statuses.length === 1 ? { status: statuses[0] } : statuses.length > 1 ? { statusIn: statuses } : {}),
      paymentStatus: paymentStatus || undefined,
      paymentMethod: paymentMethod || undefined,
      courierBooked: courierBooked || undefined,
      courierStatus: courierStatus || undefined,
      shippingDivision: division || undefined,
      shippingDistrict: district || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sortBy,
      sortDir: sortBy ? sortDir : undefined,
    };
    // The queue preset wins over an overlapping manual filter (e.g. "Unpaid" over a payment-status pick).
    return queue ? { ...base, ...(ORDER_QUEUE_FILTERS[queue] as AdminOrderListParams) } : base;
  }, [debouncedSearch, view, statuses, queue, paymentStatus, paymentMethod, courierBooked, courierStatus, division, district, dateFrom, dateTo, sortBy, sortDir]);

  const moreFiltersCount = [paymentStatus, paymentMethod, courierBooked, courierStatus, division, district, dateFrom, dateTo].filter(Boolean).length;
  const hasFilters = Boolean(debouncedSearch || statuses.length || queue || moreFiltersCount);

  // Chip wording and order come from the Orders filter definitions (order-filters.ts); removing a chip uses the same
  // setters as the controls, so paging and dependent filters (district under division) reset the same way.
  const chips = useMemo(() => {
    const values: FilterValues = {
      "f.queue": queue ?? "",
      "f.status": statuses,
      "f.payment": paymentStatus,
      "f.method": paymentMethod,
      "f.courier": courierBooked,
      "f.delivery": courierStatus,
      "f.division": division,
      "f.district": district,
      from: dateFrom,
      to: dateTo,
    };
    const removers: Record<string, (value: string) => void> = {
      "f.queue": () => selectQueue(null),
      "f.status": (value) => toggleStatus(value as OrderStatus),
      "f.payment": () => reset(setPaymentStatus)(""),
      "f.method": () => reset(setPaymentMethod)(""),
      "f.courier": () => reset(setCourierBooked)(""),
      "f.delivery": () => reset(setCourierStatus)(""),
      "f.division": () => {
        setDivision("");
        setDistrict("");
        setPage(1);
      },
      "f.district": () => reset(setDistrict)(""),
      from: () => reset(setDateFrom)(""),
      to: () => reset(setDateTo)(""),
    };
    const out: FilterChip[] = [];
    if (debouncedSearch) out.push({ key: "search", label: `“${debouncedSearch}”`, onRemove: () => reset(setSearchRaw)("") });
    for (const chip of activeFilterChips(ORDER_FILTERS, values)) out.push({ key: chip.id, label: chip.label, onRemove: () => removers[chip.filterKey]!(chip.value) });
    return out;
  }, [debouncedSearch, queue, statuses, paymentStatus, paymentMethod, courierBooked, courierStatus, division, district, dateFrom, dateTo]);

  return {
    view,
    setView: (v: OrdersView) => {
      setViewRaw(v);
      if (v === "trash") setQueueRaw(null);
      setPage(1);
    },
    search,
    setSearch: reset(setSearchRaw),
    statuses,
    toggleStatus,
    clearStatuses: () => {
      setStatuses([]);
      setQueueRaw(null);
      setPage(1);
    },
    queue,
    selectQueue,
    more: {
      paymentStatus,
      setPaymentStatus: reset(setPaymentStatus),
      paymentMethod,
      setPaymentMethod: reset(setPaymentMethod),
      courierBooked,
      setCourierBooked: reset(setCourierBooked),
      courierStatus,
      setCourierStatus: reset(setCourierStatus),
      division,
      setDivision: (v: BdDivision | "") => {
        setDivision(v);
        setDistrict("");
        setPage(1);
      },
      district,
      setDistrict: reset(setDistrict),
      dateFrom,
      setDateFrom: reset(setDateFrom),
      dateTo,
      setDateTo: reset(setDateTo),
      count: moreFiltersCount,
      clear: clearMoreFilters,
    },
    sortBy,
    sortDir,
    toggleSort,
    page,
    setPage,
    pageSize,
    setPageSize: (n: number) => {
      setPageSizeRaw(n);
      setPage(1);
    },
    filterParams,
    chips,
    hasFilters,
    clearAll,
  };
}

export type OrdersListState = ReturnType<typeof useOrdersListState>;
