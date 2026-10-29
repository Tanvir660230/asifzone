"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LIST_DEFAULT_PAGE_SIZE,
  LIST_PAGE_SIZES,
  ORDER_QUEUE_FILTERS,
  type BdDivision,
  type ListDensity,
  type ListPreferences,
  type OrderQueueId,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@clothing-brand/shared";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useListPreferences } from "@/hooks/use-list-preferences";
import { useUrlState } from "@/hooks/use-url-state";
import type { AdminOrderListParams, OrderOpsEvent } from "@/lib/api/admin-orders";
import { activeFilterChips, clearFiltersPatch, filterSchema, type FilterValues } from "@/lib/admin/filters";
import { urlParam, type UrlAliases, type UrlField } from "@/lib/url-state";
import { ORDER_FILTERS, ORDER_FILTER_URL_ALIASES } from "./order-filters";

export { ORDER_QUEUE_LABELS } from "./order-filters";

export type SortColumn = NonNullable<AdminOrderListParams["sortBy"]>;
export type OrdersView = "active" | "trash";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

const SORT_COLUMNS = ["orderNumber", "customerName", "paymentStatus", "total", "status", "createdAt", "statusChangedAt"] as const satisfies readonly SortColumn[];

/** Columns an admin may hide (Order, Customer, Status and the actions always show). */
export const ORDER_OPTIONAL_COLUMNS = [
  { id: "product", label: "Product" },
  { id: "payment", label: "Payment" },
  { id: "total", label: "Total" },
  { id: "courier", label: "Courier" },
  { id: "placed", label: "Placed" },
] as const;
export type OrderOptionalColumn = (typeof ORDER_OPTIONAL_COLUMNS)[number]["id"];

/** The key the Orders list's saved views and display preferences are stored under. */
export const ORDERS_LIST_KEY = "orders";

/**
 * The Orders list's URL (the admin URL-state grammar, lib/url-state.ts): `q` search, `view` active/trash, `sort`
 * `col`/`-col`, `page`, `size`, and one `f.*` per Orders filter definition (order-filters.ts) plus `from`/`to`. A filtered
 * list is a link — bookmarkable, shareable, and Back/Forward walk through the views. The old `?queue=` / `?status=` deep
 * links are read through aliases.
 */
/** The URL fields of the Orders filter definitions, with their keys spelled out (filterSchema returns a plain record). */
type OrderFilterFields = {
  "f.queue": UrlField<string>;
  "f.status": UrlField<string[]>;
  "f.payment": UrlField<string>;
  "f.method": UrlField<string>;
  "f.courier": UrlField<string>;
  "f.delivery": UrlField<string>;
  "f.division": UrlField<string>;
  "f.district": UrlField<string>;
  from: UrlField<string>;
  to: UrlField<string>;
  "f.ops": UrlField<string>;
  "f.opsDay": UrlField<string>;
};

const ORDERS_URL_SCHEMA = {
  q: urlParam.string(),
  view: urlParam.enum(["active", "trash"], "active"),
  sort: urlParam.sort(SORT_COLUMNS),
  page: urlParam.page(),
  // 0 = not in the link: the admin's stored page size applies (then the default 50). Old 10/20 links round up to 25.
  size: urlParam.size(LIST_PAGE_SIZES, 0, { roundUp: true }),
  // The order open in the drawer — a refresh or a shared link reopens it.
  open: urlParam.string(),
  ...(filterSchema(ORDER_FILTERS) as OrderFilterFields),
};
const ALIASES = ORDER_FILTER_URL_ALIASES as UrlAliases<typeof ORDERS_URL_SCHEMA>;

/** The filters behind the "Filters" popover (everything except search, status and queue). */
const MORE_KEYS = ["f.payment", "f.method", "f.courier", "f.delivery", "f.division", "f.district", "from", "to", "f.ops", "f.opsDay"] as const;

/**
 * All of the Orders list's view state in one place, persisted in the URL: view (active/trash), search, multi-status, the
 * quick-filter queue, the "more filters" set, sort and paging — and what they become as list-query params and removable
 * chips. A queue is a preset from @clothing-brand/shared (ORDER_QUEUE_FILTERS), the same object the server counts for its
 * badge. Choosing a view, status, queue, filter, sort or page adds a history entry (Back undoes it); typing in search
 * replaces the current one, so Back isn't a keystroke-by-keystroke undo.
 */
export function useOrdersListState({ mode = "work" }: { mode?: "work" | "history" } = {}) {
  const history = mode === "history";
  const [url, push] = useUrlState(ORDERS_URL_SCHEMA, { aliases: ALIASES, history: "push" });
  const [, replace] = useUrlState(ORDERS_URL_SCHEMA, { aliases: ALIASES });

  // Order history has no Trash view and no work queues — only finished orders, searched and filtered.
  const view = history ? "active" : (url.view as OrdersView);
  const statuses = url["f.status"] as OrderStatus[];
  const queue = history ? null : (url["f.queue"] as OrderQueueId | "") || null;
  const more = {
    paymentStatus: url["f.payment"] as PaymentStatus | "",
    paymentMethod: url["f.method"] as PaymentMethod | "",
    courierBooked: url["f.courier"] as "" | "true" | "false",
    courierStatus: url["f.delivery"] as string,
    division: url["f.division"] as BdDivision | "",
    district: url["f.district"] as string,
    dateFrom: url.from as string,
    dateTo: url.to as string,
    opsEvent: url["f.ops"] as OrderOpsEvent | "",
    opsDate: url["f.opsDay"] as string,
  };
  // With no column chosen, the main list shows the latest activity first: an order placed days ago and confirmed or
  // booked today is back at the top. A queue keeps its own (newest-placed-first) order.
  const sortBy: SortColumn | undefined = url.sort?.column ?? (queue ? undefined : "statusChangedAt");
  const sortDir = url.sort?.dir ?? "desc";
  /** What the "Order by" switch shows: latest activity, date placed, or a column header's sort. */
  const orderBy: "activity" | "placed" | "column" = (sortBy ?? "createdAt") === "statusChangedAt" ? "activity" : (sortBy ?? "createdAt") === "createdAt" && sortDir === "desc" ? "placed" : "column";
  const page = url.page;
  // A link's own size wins; otherwise this admin's stored choice; otherwise 50 (plan M10).
  const display = useListPreferences(ORDERS_LIST_KEY);
  const pageSize = url.size || display.prefs.pageSize || LIST_DEFAULT_PAGE_SIZE;
  const density: ListDensity = display.prefs.density ?? "standard";
  const hiddenColumns = useMemo(
    () => new Set((display.prefs.hiddenColumns ?? []).filter((c): c is OrderOptionalColumn => ORDER_OPTIONAL_COLUMNS.some((o) => o.id === c))),
    [display.prefs.hiddenColumns],
  );

  // The search box types into local state; the URL gets the debounced value. Back/Forward (or a cleared search) moves
  // the URL underneath the box, so it follows.
  const [search, setSearchRaw] = useState(url.q);
  const debouncedSearch = useDebouncedValue(search, 350);
  useEffect(() => {
    if (debouncedSearch !== url.q) replace({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);
  useEffect(() => setSearchRaw(url.q), [url.q]);

  const set = (patch: Partial<typeof url>) => push(patch);
  const clearMorePatch = Object.fromEntries(MORE_KEYS.map((k) => [k, ""])) as Partial<typeof url>;

  function toggleStatus(status: OrderStatus) {
    push((cur) => {
      const list = cur["f.status"] as OrderStatus[];
      return { "f.status": list.includes(status) ? list.filter((s) => s !== status) : [...list, status], "f.queue": "" };
    });
  }
  function selectQueue(id: OrderQueueId | null) {
    // A queue is a complete preset (some imply a status) — it replaces the status selection rather than intersecting it.
    push((cur) => ({ "f.queue": id === null || cur["f.queue"] === id ? "" : id, "f.status": [], view: "active" }));
  }
  function toggleSort(column: SortColumn) {
    push((cur) => ({ sort: cur.sort?.column === column ? { column, dir: cur.sort.dir === "asc" ? "desc" : "asc" } : { column, dir: "asc" } }));
  }
  function clearAll() {
    setSearchRaw("");
    push({ q: "", ...(clearFiltersPatch(ORDER_FILTERS) as Partial<typeof url>) });
  }

  const filterParams = useMemo<AdminOrderListParams>(() => {
    const base: AdminOrderListParams = {
      search: url.q || undefined,
      deleted: view === "trash",
      ...(statuses.length === 1 ? { status: statuses[0] } : statuses.length > 1 ? { statusIn: statuses } : {}),
      paymentStatus: more.paymentStatus || undefined,
      paymentMethod: more.paymentMethod || undefined,
      courierBooked: more.courierBooked || undefined,
      courierStatus: more.courierStatus || undefined,
      shippingDivision: more.division || undefined,
      shippingDistrict: more.district || undefined,
      dateFrom: more.dateFrom || undefined,
      dateTo: more.dateTo || undefined,
      ...(more.opsEvent && more.opsDate ? { opsEvent: more.opsEvent, opsDate: more.opsDate } : {}),
      sortBy,
      sortDir: sortBy ? sortDir : undefined,
      // The daily work list leaves finished orders out (they are in Order history). A search still finds every order — a
      // scanned tracking code or a customer's phone must land on the order wherever it is — and so does a daily-pulse
      // drill-down, which lists exactly what the pulse counted.
      scope: history ? "history" : view === "active" && !queue && !url.q && !(more.opsEvent && more.opsDate) ? "active" : undefined,
    };
    // The queue preset wins over an overlapping manual filter (e.g. "Unpaid" over a payment-status pick).
    return queue ? { ...base, ...(ORDER_QUEUE_FILTERS[queue] as AdminOrderListParams) } : base;
    // `url` is re-parsed only when the query string changes; its fields are what this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const moreFiltersCount = MORE_KEYS.filter((k) => Boolean(url[k])).length;
  const hasFilters = Boolean(url.q || statuses.length || queue || moreFiltersCount);

  // Chip wording and order come from the Orders filter definitions (order-filters.ts); removing a chip goes through the
  // same URL patches as the controls, so paging and dependent filters (district under division) reset the same way.
  const chips = useMemo(() => {
    const values: FilterValues = Object.fromEntries(ORDER_FILTERS.map((f) => [f.key, url[f.key as keyof typeof url] as string | string[]]));
    const out: FilterChip[] = [];
    if (url.q)
      out.push({
        key: "search",
        label: `“${url.q}”`,
        onRemove: () => {
          setSearchRaw("");
          push({ q: "" });
        },
      });
    for (const chip of activeFilterChips(ORDER_FILTERS, values)) {
      const remove = () => {
        if (chip.filterKey === "f.status") toggleStatus(chip.value as OrderStatus);
        else if (chip.filterKey === "f.division") push({ "f.division": "", "f.district": "" });
        else push({ [chip.filterKey]: "" } as Partial<typeof url>);
      };
      out.push({ key: chip.id, label: chip.label, onRemove: remove });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return {
    view,
    setView: (v: OrdersView) => set(v === "trash" ? { view: v, "f.queue": "" } : { view: v }),
    search,
    setSearch: setSearchRaw,
    statuses,
    toggleStatus,
    clearStatuses: () => set({ "f.status": [], "f.queue": "" }),
    queue,
    selectQueue,
    more: {
      ...more,
      setPaymentStatus: (v: PaymentStatus | "") => set({ "f.payment": v }),
      setPaymentMethod: (v: PaymentMethod | "") => set({ "f.method": v }),
      setCourierBooked: (v: "" | "true" | "false") => set({ "f.courier": v }),
      setCourierStatus: (v: string) => set({ "f.delivery": v }),
      setDivision: (v: BdDivision | "") => set({ "f.division": v, "f.district": "" }),
      setDistrict: (v: string) => set({ "f.district": v }),
      setDateFrom: (v: string) => set({ from: v }),
      setDateTo: (v: string) => set({ to: v }),
      count: moreFiltersCount,
      clear: () => set(clearMorePatch),
    },
    sortBy,
    sortDir,
    toggleSort,
    orderBy,
    setOrderBy: (v: "activity" | "placed") =>
      push({ sort: v === "placed" ? { column: "createdAt", dir: "desc" } : queue ? { column: "statusChangedAt", dir: "desc" } : null }),
    page,
    setPage: (p: number) => set({ page: p }),
    /** Move to another page without a history entry — used when the current page emptied under the admin. */
    replacePage: (p: number) => replace({ page: p }),
    pageSize,
    setPageSize: (n: number) => {
      display.update({ pageSize: n as ListPreferences["pageSize"] });
      set({ size: n });
    },
    /** Wait for this before loading rows when the link has no size, so the list doesn't load at 50 and then again. */
    pageSizeReady: Boolean(url.size) || display.ready,
    density,
    setDensity: (d: ListDensity) => display.update({ density: d }),
    hiddenColumns,
    toggleColumn: (id: OrderOptionalColumn) => {
      const next = new Set(hiddenColumns);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      display.update({ hiddenColumns: [...next] });
    },
    openOrderId: url.open || null,
    /** Opening an order adds a history entry (Back closes it); stepping to a neighbour and closing replace it. */
    openOrder: (id: string | null, { step = false }: { step?: boolean } = {}) => (id && !step && !url.open ? push({ open: id }) : replace({ open: id ?? "" })),
    filterParams,
    chips,
    hasFilters,
    clearAll,
  };
}

export type OrdersListState = ReturnType<typeof useOrdersListState>;
