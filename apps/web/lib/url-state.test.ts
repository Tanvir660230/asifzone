import { describe, expect, it } from "vitest";
import { assertUrlSchema, isUrlStateKey, nextSearch, parseUrlState, urlParam } from "./url-state";
import { activeFilterChips, clearFiltersPatch, filterSchema, removeChipPatch, setFilterPatch } from "./admin/filters";
import { ORDER_FILTER_URL_ALIASES, ORDER_FILTERS } from "@/components/admin/orders/order-filters";

// P1.6 / P1.8 — the URL-state grammar and filter definitions.

const schema = {
  q: urlParam.string(),
  page: urlParam.page(),
  size: urlParam.size([10, 20, 50], 20),
  sort: urlParam.sort(["createdAt", "total"] as const),
  "f.status": urlParam.list(["PENDING", "SHIPPED", "DELIVERED"] as const),
  "f.paid": urlParam.boolean(),
  from: urlParam.date(),
  step: urlParam.enum(["basics", "media", "pricing"] as const, "basics"),
};

describe("URL-state grammar", () => {
  it("accepts the reserved keys and f.*, nothing else", () => {
    for (const k of ["q", "view", "sort", "page", "size", "tab", "from", "to", "cmp", "gran", "open", "step", "f.status", "f.payment-method"]) expect(isUrlStateKey(k), k).toBe(true);
    for (const k of ["queue", "status", "f.", "filter", "p"]) expect(isUrlStateKey(k), k).toBe(false);
    expect(() => assertUrlSchema({ queue: urlParam.string() } as never)).toThrow(/grammar/);
  });

  it("parses typed values and falls back to defaults on bad input", () => {
    const v = parseUrlState(schema, new URLSearchParams("q=tee&page=3&size=50&sort=-total&f.status=SHIPPED,BOGUS,SHIPPED&f.paid=1&from=2026-10-01&step=media"));
    expect(v).toEqual({ q: "tee", page: 3, size: 50, sort: { column: "total", dir: "desc" }, "f.status": ["SHIPPED"], "f.paid": true, from: "2026-10-01", step: "media" });
    const bad = parseUrlState(schema, new URLSearchParams("page=-2&size=33&sort=-password&from=yesterday&step=nope&f.paid=maybe"));
    expect(bad).toMatchObject({ page: 1, size: 20, sort: null, from: "", step: "basics", "f.paid": false });
  });

  it("writes only non-defaults, keeps foreign keys, and resets paging when a filter changes", () => {
    const current = new URLSearchParams("page=4&utm=x&q=old");
    expect(nextSearch(schema, current, { q: "new" }).toString()).toBe("utm=x&q=new");
    expect(nextSearch(schema, current, { page: 5 }).get("page")).toBe("5");
    expect(nextSearch(schema, current, { "f.status": ["PENDING", "DELIVERED"] }).toString()).toBe("utm=x&q=old&f.status=PENDING%2CDELIVERED");
    expect(nextSearch(schema, new URLSearchParams("size=50&page=2"), { size: 20 }).toString()).toBe("");
  });

  it("leaves the Product Builder's step alone unless asked", () => {
    expect(nextSearch(schema, new URLSearchParams("step=media"), { q: "x" }).get("step")).toBe("media");
  });
});

describe("filter definitions", () => {
  const defs = ORDER_FILTERS;
  const ordersSchema = filterSchema(defs);

  it("reads the Orders deep links the dashboard sends (?queue= / ?status=) and their f.* names", () => {
    const legacy = parseUrlState(ordersSchema, new URLSearchParams("queue=unpaid&status=PENDING,CONFIRMED"), ORDER_FILTER_URL_ALIASES);
    expect(legacy["f.queue"]).toBe("unpaid");
    expect(legacy["f.status"]).toEqual(["PENDING", "CONFIRMED"]);
    expect(parseUrlState(ordersSchema, new URLSearchParams("f.queue=cod"), ORDER_FILTER_URL_ALIASES)["f.queue"]).toBe("cod");
    expect(parseUrlState(ordersSchema, new URLSearchParams("queue=hacked"), ORDER_FILTER_URL_ALIASES)["f.queue"]).toBe("");
  });

  it("words Orders chips exactly as the Orders list always has", () => {
    const chips = activeFilterChips(defs, {
      "f.queue": "refundDue",
      "f.status": ["PENDING", "PARTIALLY_DELIVERED"],
      "f.payment": "PARTIALLY_PAID",
      "f.method": "SSLCOMMERZ",
      "f.courier": "false",
      "f.delivery": "in_review",
      "f.division": "Dhaka",
      "f.district": "Gazipur",
      from: "2026-10-01",
      to: "2026-10-07",
    }).map((c) => c.label);
    expect(chips).toEqual([
      "Returned · refund due",
      "Status: Pending",
      "Status: Partial",
      "Payment: Part paid",
      "Method: SSLCOMMERZ",
      "Courier: not booked",
      "Delivery: In review",
      "Division: Dhaka",
      "District: Gazipur",
      "From 2026-10-01",
      "To 2026-10-07",
    ]);
  });

  it("clears dependants: removing or changing the division clears the district", () => {
    const values = { "f.division": "Dhaka", "f.district": "Gazipur" };
    const chip = activeFilterChips(defs, values).find((c) => c.filterKey === "f.division")!;
    expect(removeChipPatch(defs, values, chip)).toEqual({ "f.division": "", "f.district": "" });
    expect(setFilterPatch(defs, "f.division", "Khulna")).toEqual({ "f.division": "Khulna", "f.district": "" });
    expect(clearFiltersPatch(defs)["f.status"]).toEqual([]);
  });
});
