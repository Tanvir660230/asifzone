/**
 * The metric registry (docs/METRICS_REGISTRY.md §4) — one entry per business metric: its key, meaning, unit, time
 * basis and which groupings its definition supports. The API validates requests against it and the web reads labels
 * from it; the calculation lives in ./aggregate.ts.
 */

export type MetricUnit = "money" | "count" | "ratio";
export type MetricBasis = "placed" | "realised" | "returned" | "refunded" | "settled" | "mixed" | "event" | "now" | "lifetime";
export type MetricGrouping = "day" | "month" | "year" | "payment_method" | "product" | "category" | "brand" | "customer";
export const METRIC_GROUPINGS: readonly MetricGrouping[] = ["day", "month", "year", "payment_method", "product", "category", "brand", "customer"];

export interface MetricDefinition {
  key: string;
  label: string;
  description: string;
  unit: MetricUnit;
  basis: MetricBasis;
  status: "active" | "pending";
  /** Uses the current cost price (P5-6). */
  estimated?: boolean;
  groupings: readonly MetricGrouping[];
}

const TIME: MetricGrouping[] = ["day", "month", "year"];
const ORDER_LEVEL: MetricGrouping[] = [...TIME, "payment_method", "customer"];
const LINE_LEVEL: MetricGrouping[] = [...ORDER_LEVEL, "product", "category", "brand"];
const NONE: MetricGrouping[] = [];

function def(key: string, label: string, unit: MetricUnit, basis: MetricBasis, groupings: MetricGrouping[], description: string, extra: Partial<MetricDefinition> = {}): MetricDefinition {
  return { key, label, unit, basis, groupings, description, status: "active", ...extra };
}

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  // Sales & financial
  def("orders_placed", "Orders placed", "count", "placed", ORDER_LEVEL, "Sale orders (not trashed, not cancelled, not exchange replacements) by placement time."),
  def("orders_realised", "Orders realised", "count", "realised", ORDER_LEVEL, "Sale orders by realisation time: COD at first delivery, online at first successful payment (D1)."),
  def("orders_cancelled", "Orders cancelled", "count", "placed", ORDER_LEVEL, "Cancelled orders (not trashed, not exchange replacements) by placement time."),
  def("cancelled_order_value", "Cancelled order value", "money", "placed", ORDER_LEVEL, "Σ total of cancelled orders by placement time."),
  def("gross_merchandise_sales", "Gross merchandise sales", "money", "realised", LINE_LEVEL, "Σ price snapshot × quantity of realised sale orders (after flash sales, before bundle/coupon, excl. shipping and tax)."),
  def("discounts", "Discounts", "money", "realised", LINE_LEVEL, "Σ order discount (bundle + coupon) of realised sale orders, from the snapshot."),
  def("bundle_discount", "Bundle discounts", "money", "realised", ORDER_LEVEL, "Bundle part of discounts (snapshot)."),
  def("coupon_discount", "Coupon discounts", "money", "realised", ORDER_LEVEL, "Coupon part of discounts (snapshot)."),
  def("flash_discount", "Flash-sale discounts", "money", "realised", ORDER_LEVEL, "Σ recorded flash discount (list − flash) of realised sale orders; orders before Phase 2 have none recorded (coverage)."),
  def("shipping_charged", "Shipping charged", "money", "realised", ORDER_LEVEL, "Shipping actually charged on realised sale orders (0 when waived)."),
  def("price_adjustments", "Price adjustments", "money", "realised", ORDER_LEVEL, "Σ admin price adjustments of realised sale orders."),
  def("tax_collected", "Tax (VAT) collected", "money", "realised", ORDER_LEVEL, "Σ tax snapshot of realised sale orders; orders without a snapshot are reported as coverage, never estimated."),
  def("returns", "Returns", "money", "returned", LINE_LEVEL, "Returned units × their net unit value (after discounts), at the return date. Exchange-returned units are not returns."),
  def("net_merchandise_sales", "Net merchandise sales", "money", "mixed", LINE_LEVEL, "Gross merchandise sales − discounts − returns."),
  def("net_sales", "Net sales", "money", "mixed", ORDER_LEVEL, "Gross merchandise sales − discounts + shipping charged + price adjustments − returns (D1 realised revenue before the refund term)."),
  def("realised_revenue", "Realised revenue", "money", "mixed", NONE, "D1 realised revenue: net sales − refunds not already counted as returns. Pending decision PD-5.1.", { status: "pending" }),
  def("refunds", "Refunds", "money", "refunded", ORDER_LEVEL, "Σ completed refunds (payment ledger) by completion time."),
  def("refund_count", "Refunds recorded", "count", "refunded", ORDER_LEVEL, "Completed refunds by completion time."),
  def("payments_received", "Payments received", "money", "settled", ORDER_LEVEL, "Σ successful payments (gateway, COD collected, manual) by settlement time."),
  def("payment_count", "Payments", "count", "settled", ORDER_LEVEL, "Successful payments by settlement time."),
  def("collected_cash", "Collected cash", "money", "mixed", ORDER_LEVEL, "Payments received − refunds (payment ledger)."),
  def("exchange_difference_collected", "Exchange differences collected", "money", "settled", ORDER_LEVEL, "Payments on exchange replacement orders (not sales — P5-3)."),
  def("outstanding_cod", "Outstanding COD", "money", "now", NONE, "Cash couriers still have to collect: Σ codToCollect of current orders (payment ledger)."),
  def("amount_due", "Amount due", "money", "now", NONE, "Σ balance due of open orders (payment ledger)."),
  def("refund_due", "Refunds owed", "money", "now", NONE, "Σ money owed back to customers (payment ledger)."),
  def("aov", "Average order value", "money", "realised", TIME, "Net sales ÷ orders realised (interim basis until PD-5.1)."),
  def("cod_orders_placed", "COD orders placed", "count", "placed", ORDER_LEVEL, "Sale orders paid by cash on delivery, by placement time."),
  def("courier_loss", "Courier loss", "money", "event", TIME, "Σ courier-loss ledger (estimated return-leg fees)."),
  def("cogs_estimated", "Cost of goods (estimated)", "money", "mixed", LINE_LEVEL, "Net units sold × current cost price.", { estimated: true }),
  def("gross_margin_estimated", "Gross margin (estimated)", "money", "mixed", LINE_LEVEL, "Net merchandise sales − estimated cost of goods.", { estimated: true }),
  // Product
  def("units_ordered", "Units ordered", "count", "placed", LINE_LEVEL, "Units on sale orders by placement time (demand)."),
  def("units_sold", "Units sold", "count", "realised", LINE_LEVEL, "Units on realised sale orders."),
  def("units_returned", "Units returned", "count", "returned", LINE_LEVEL, "Units returned by customers (exchanges excluded)."),
  def("net_units_sold", "Net units sold", "count", "mixed", LINE_LEVEL, "Units sold − units returned."),
  // Customer (groupings of the facts above)
  def("customers_with_orders", "Customers with orders", "count", "placed", TIME, "Distinct customers with at least one sale order placed in the range."),
  def("repeat_customer_rate", "Repeat customer rate", "ratio", "placed", NONE, "Customers with ≥ 2 sale orders ÷ customers with ≥ 1, in the range."),
  def("customer_lifetime_value", "Customer lifetime value", "money", "lifetime", NONE, "Average net sales per customer with at least one realised order, in the range."),
  // Inventory (point in time; read-only)
  def("stock_on_hand", "Stock on hand", "count", "now", NONE, "Σ stock of tracked, active variants of products not in trash."),
  def("low_stock_variants", "Low-stock variants", "count", "now", NONE, "Sellable tracked variants at or below their product's low-stock threshold (per variant)."),
  def("out_of_stock_variants", "Out-of-stock variants", "count", "now", NONE, "Sellable tracked variants with no stock."),
  def("inventory_value", "Inventory value", "money", "now", NONE, "Σ stock × current cost of tracked, active variants of products not in trash.", { estimated: true }),
];

const BY_KEY = new Map(METRIC_DEFINITIONS.map((d) => [d.key, d]));

export function metricDefinition(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}
