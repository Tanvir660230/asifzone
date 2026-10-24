/**
 * The stock hub API (docs/STOCK_HUB.md §5, /admin/stock): the overview, Bought (a purchase in one form), Counted, and the
 * purchases list, Filled (a resumable entry) and one item's trace. Money in major units; Bought, Counted and Filled carry an
 * Idempotency-Key — the same key replays, so a double tap or a retry writes once.
 */
import { ApiError, apiFetch } from "../api-client";
import { formatPrice } from "../format";

const BASE = "/api/v1/finance/stock";

export type StockGroupKey = "FINISHED" | "FILL_TO_ORDER" | "MATERIAL";

export interface StockItem {
  variantId: string;
  productId: string;
  sku: string;
  /** "Product — size / colour". */
  name: string;
  productName: string;
  size: string | null;
  color: string | null;
  unit: string;
  /** Filled bottles for a fill-to-order variant (negative: ordered, not filled yet). */
  stock: number;
  /** Units on orders not yet booked with the courier — still on the shelf. */
  reserved: number;
  expectedOnShelf: number;
  /** Fill to order only: bottles the recipe can still make from the free materials. */
  makeable: number | null;
  /** Fill-to-order only: how it sells past the filled bottles; `owed` = bottles sold, not yet filled. */
  policy: { policy: StockPolicy; overridden: boolean; backorderLimit: number | null; owed: number } | null;
  /** Materials only: RAW (oil — by volume or weight) or PACKAGING (bottles, boxes, stickers, poly — in pieces). */
  materialKind: "RAW" | "PACKAGING" | null;
  avgCost: number | null;
  value: number | null;
  usedPerDay: number | null;
  daysLeft: number | null;
  low: boolean;
}

export interface StockRoll { id: string; materialVariantId: string; material: string; openedOn: string; parcels: number; rollCost: number | null }

export interface StockOverview {
  /** Null without costing.read. */
  totalValue: number | null;
  costingActive: boolean;
  groups: Array<{ key: StockGroupKey; items: StockItem[] }>;
  lastCount: string | null;
  rolls: StockRoll[];
}

export type PurchaseStep = "supplier" | "receipt" | "invoice" | "funding" | "payment" | "extras";

export interface StockPurchase {
  id: string;
  date: string;
  supplier: { id: string | null; name: string };
  reference: string | null;
  note: string | null;
  lines: Array<{ variantId: string; name: string; unit: string; quantity: number; amount: number | null; unitCost: number | null }>;
  extrasLines: Array<{ description: string; amount: number | null }>;
  goods: number | null;
  extras: number | null;
  total: number | null;
  paidFrom: { kind: "ACCOUNT" | "OWNER"; financialAccountId: string | null; name: string };
  receipt: { id: string; number: string | null } | null;
  invoice: { id: string; number: string | null } | null;
  paymentStatus: string | null;
  landedCostId: string | null;
  complete: boolean;
  pendingStep: PurchaseStep | null;
  createdAt: string;
}

export type PaidFrom = { financialAccountId: string } | { ownerPocket: true };

export interface PurchaseBody {
  date?: string;
  supplierName?: string | null;
  reference?: string | null;
  note?: string | null;
  lines: Array<{ variantId: string; quantity: number; amount: number }>;
  /** Total units on the supplier's bill — the lines must add up to it. */
  documentTotal: number;
  extras: Array<{ description: string; amount: number }>;
  paidFrom: PaidFrom;
}

export interface PurchaseResult { receiptId: string | null; invoiceId: string | null; landedCostId: string | null; replayed: boolean; purchase: StockPurchase }

export type CountReason = "DAMAGED" | "LOST" | "SAMPLE" | "FOUND" | "COUNT_FIX";
export interface CountBody {
  date?: string;
  /** Products counted as a whole grid: every size must be on the sheet (0 when none). */
  products?: string[];
  lines: Array<{ variantId: string; counted: number; reason?: CountReason | null; note?: string | null }>;
}
export interface CountResult {
  id: string;
  date: string;
  replayed: boolean;
  lines: Array<{ variantId: string; expected: number; counted: number; difference: number; movementId: string | null }>;
}

export const stockKeys = {
  all: ["stock-hub"] as const,
  overview: () => ["stock-hub", "overview"] as const,
  purchases: () => ["stock-hub", "purchases"] as const,
  trace: (variantId: string) => ["stock-hub", "trace", variantId] as const,
};

export const getStockOverview = () => apiFetch<StockOverview>(BASE);
export const listStockPurchases = (limit = 20) => apiFetch<{ purchases: StockPurchase[] }>(`${BASE}/purchases?limit=${limit}`);
export const recordStockPurchase = (body: PurchaseBody, idempotencyKey: string) => apiFetch<PurchaseResult>(`${BASE}/purchases`, { method: "POST", body, idempotencyKey });
export const finishStockPurchase = (id: string, body: { paidFrom?: PaidFrom }) => apiFetch<PurchaseResult>(`${BASE}/purchases/${id}/finish`, { method: "POST", body });
export const recordStockCount = (body: CountBody, idempotencyKey: string) => apiFetch<CountResult>(`${BASE}/counts`, { method: "POST", body, idempotencyKey });

export interface FillBody {
  variantId: string;
  quantity: number;
  /** Material spilt or spoilt on top of the recipe, in its stock unit; needs wasteReason. */
  wasted?: Array<{ materialVariantId: string; quantity: number }>;
  wasteReason?: string | null;
  note?: string | null;
}
export interface StockFill {
  id: string;
  complete: boolean;
  date: string | null;
  recordedAt: string;
  by: string | null;
  productionOrderId: string | null;
  number: string | null;
  variantId: string;
  sku: string | null;
  product: string | null;
  quantity: number;
  wasteReason: string | null;
  materials: Array<{ sku: string; name: string; unit: string; used: number; wasted: number; value: number | null }>;
  cost: number | null;
  perBottle: number | null;
}
export const recordFill = (body: FillBody, idempotencyKey: string) => apiFetch<{ fill: StockFill; replayed: boolean }>(`${BASE}/fills`, { method: "POST", body, idempotencyKey });

export type FillReadiness = "READY" | "PARTLY_FILLED" | "AWAITING_FILL";
export interface StockTrace {
  variantId: string;
  sku: string;
  name: string;
  productId: string;
  productName: string;
  unit: string;
  kind: StockGroupKey;
  stock: number;
  waiting: number;
  onShelf: number;
  owed: number;
  makeable: number | null;
  policy: { policy: StockPolicy; backorderLimit: number | null } | null;
  recipe: {
    version: number;
    lines: Array<{
      materialVariantId: string; sku: string; name: string; unit: string; materialKind: "RAW" | "PACKAGING"; perBottle: number; wastagePct: number; suppliedBy: string; inStock: number; avgCost: number | null;
      recentPurchases: Array<{ date: string; quantity: number; note: string | null; unitCost: number | null }>;
    }>;
  } | null;
  recipeMissing: boolean;
  waitingOrders: Array<{ orderId: string; orderNumber: string; placedAt: string; units: number; filled: number; toFill: number; status: FillReadiness }>;
  fills: Array<{
    productionOrderId: string; number: string; status: string; date: string; by: string | null; bottles: number; wasteReason: string | null;
    materials: Array<{ sku: string; name: string; unit: string; used: number; wasted: number; value: number | null }>;
    cost: number | null; perBottle: number | null;
  }>;
  last90Days: { sold: number; cancelled: number; returned: number; filled: number; bought: number; counted: number; materialUse: number };
  valuation: { valuedQty: number; unvaluedQty: number; deficitQty: number; value: number | null; avgCost: number | null } | null;
  unresolvedCosts: Array<{ id: string; title: string; amount: number | null; at: string }>;
}
export const getStockTrace = (variantId: string) => apiFetch<StockTrace>(`${BASE}/items/${variantId}/trace`);

export type StockPolicy = "TRACKED" | "UNLIMITED" | "BACKORDER";
export interface StockPolicyBody { policy: StockPolicy; backorderLimit?: number | null; variants?: Array<{ variantId: string; policy: StockPolicy | null }>; reason: string }
export const setStockPolicy = (productId: string, body: StockPolicyBody) => apiFetch<{ productId: string; policy: StockPolicy; backorderLimit: number | null }>(`${BASE}/products/${productId}/policy`, { method: "PUT", body });

// ── errors ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StockProblem {
  code: string | null;
  title: string;
  detail: string;
  /** Only INSUFFICIENT_FUNDS. */
  funds?: { balance: number; needed: number };
}

const TITLES: Record<string, string> = {
  COSTING_NOT_ACTIVE: "Stock costing starts at go-live",
  INSUFFICIENT_FUNDS: "Not enough money in that account",
  SUPPLIER_ON_HOLD: "This supplier is on hold",
  BEFORE_OPENING_DATE: "That date is before the books start",
  PERIOD_CLOSED: "That month is closed",
  PERIOD_SOFT_CLOSED: "That month is soft-closed",
  OPENING_DATE_NOT_SET: "The books haven't started yet",
  STOCK_ENTRY_IN_PROGRESS: "Still saving",
  STOCK_ENTRY_LEASE_LOST: "Another try took over",
  IDEMPOTENCY_KEY_REUSED: "This form was already sent with different details",
  PAID_FROM_LOCKED: "Part of it is already paid",
  STOCK_PURCHASE_PERMISSION: "You can't record this",
  OWNER_POCKET_UNUSABLE: "The owner's own-money account can't be used",
  FUNDING_NEEDS_APPROVAL: "The owner's money is waiting for approval",
  PAYMENT_SOURCE_KIND: "That account can't pay",
  FINANCIAL_ACCOUNT_NOT_FOUND: "That money account is gone",
  PURCHASE_IN_FUTURE: "The date is in the future",
  PURCHASE_LINE_AMOUNT: "A line total is too small",
  PURCHASE_UNTRACKED: "An item isn't stock-tracked",
  VARIANT_NOT_FOUND: "An item no longer exists",
  COUNT_REASON: "Say why the count differs",
  COUNT_BELOW_ORDERS: "Fewer on the shelf than orders are waiting for",
  COUNT_UNTRACKED: "An item isn't stock-tracked",
  STOCK_COUNT_FUTURE: "The date is in the future",
  NO_RECIPE: "No approved recipe",
  REFILL_STOPPED: "The fill stopped part-way",
  FILL_STOPPED: "The fill stopped part-way",
  FILL_SHORT: "Not enough in stock for this fill",
  FILL_MATERIAL_NOT_IN_RECIPE: "That material isn't in the recipe",
  RECIPE_EMPTY: "The recipe has nothing to take from stock",
};

const DETAIL: Record<string, string> = {
  STOCK_ENTRY_IN_PROGRESS: "The first tap is still being saved. Wait a moment and try again; it won't be recorded twice.",
  STOCK_ENTRY_LEASE_LOST: "A newer try of this entry took over. Reload the page to see where it stands.",
  IDEMPOTENCY_KEY_REUSED: "Close this form and open it again to record it as a new entry.",
};

/** The error code and extras the API sends in `details` (financeError). */
export function stockErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const d = err.details as { code?: unknown } | undefined;
  return typeof d?.code === "string" ? d.code : null;
}

/** A clear title + what to do, for any error from the stock hub's endpoints (and the quick refill). */
export function describeStockError(err: unknown, fallbackTitle: string): StockProblem {
  if (!(err instanceof ApiError)) return { code: null, title: fallbackTitle, detail: "Check your connection and try again." };
  const code = stockErrorCode(err);
  const d = err.details as { balance?: unknown; needed?: unknown; fieldErrors?: Record<string, string[] | undefined>; formErrors?: string[] } | undefined;
  if (code === "INSUFFICIENT_FUNDS" && typeof d?.balance === "number" && typeof d?.needed === "number") {
    return {
      code,
      title: TITLES[code]!,
      detail: `It holds ${formatPrice(d.balance)} but this needs ${formatPrice(d.needed)}. Top it up, or pay from another account.`,
      funds: { balance: d.balance, needed: d.needed },
    };
  }
  if (err.status === 403 && !code) return { code: null, title: "You can't do this", detail: "Your role doesn't allow it. Ask the owner." };
  if (err.status === 400 && !code) {
    const fields = [...(d?.formErrors ?? []), ...Object.values(d?.fieldErrors ?? {}).flat()].filter((m): m is string => Boolean(m));
    return { code: null, title: "Check the form", detail: fields.length ? fields.slice(0, 3).join("; ") : err.message };
  }
  return { code, title: (code && TITLES[code]) ?? fallbackTitle, detail: (code && DETAIL[code]) ?? err.message };
}

/** Errors that mean nothing was written: the same form can be fixed and sent again. */
export const CHECKED_BEFORE_WRITING = new Set([
  "COSTING_NOT_ACTIVE", "INSUFFICIENT_FUNDS", "SUPPLIER_ON_HOLD", "BEFORE_OPENING_DATE", "PERIOD_CLOSED", "PERIOD_SOFT_CLOSED", "OPENING_DATE_NOT_SET",
  "STOCK_PURCHASE_PERMISSION", "PAYMENT_SOURCE_KIND", "FINANCIAL_ACCOUNT_NOT_FOUND", "PURCHASE_IN_FUTURE", "PURCHASE_LINE_AMOUNT", "PURCHASE_UNTRACKED",
  "VARIANT_NOT_FOUND", "OWNER_POCKET_UNUSABLE", "IDEMPOTENCY_KEY_REUSED", "STOCK_ENTRY_IN_PROGRESS", "FILL_SHORT", "NO_RECIPE", "FILL_MATERIAL_NOT_IN_RECIPE",
]);

export const PENDING_STEP_LABEL: Record<PurchaseStep, string> = {
  supplier: "adding the supplier",
  receipt: "receiving the goods",
  invoice: "the supplier bill",
  funding: "putting in the owner's money",
  payment: "the payment",
  extras: "the extra costs",
};
