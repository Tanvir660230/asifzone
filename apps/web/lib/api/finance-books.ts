/**
 * The owner's-books API (docs/FINANCE_OWNER_BOOKS.md): who holds the money, courier and gateway charges, ad spend,
 * prepaid costs, packaging, landed costs, quick refills and profit. Money in major units; anything that moves money
 * carries an Idempotency-Key.
 */
import { apiFetch } from "../api-client";
import type { FinancialAccountKind, Movement } from "./finance";

const BASE = "/api/v1/finance";
const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

export const booksKeys = {
  all: ["finance", "books"] as const,
  moneyMap: () => ["finance", "books", "money-map"] as const,
  custody: () => ["finance", "books", "custody"] as const,
  counts: () => ["finance", "books", "cash-counts"] as const,
  rateCards: () => ["finance", "books", "rate-cards"] as const,
  courier: () => ["finance", "books", "courier"] as const,
  campaigns: (q: { from?: string; to?: string }) => ["finance", "books", "campaigns", q] as const,
  prepaid: () => ["finance", "books", "prepaid"] as const,
  packaging: () => ["finance", "books", "packaging"] as const,
  landed: () => ["finance", "books", "landed"] as const,
  landedReceipts: () => ["finance", "books", "landed-receipts"] as const,
  refills: () => ["finance", "books", "refills"] as const,
  profit: (q: { from?: string; to?: string }) => ["finance", "books", "profit", q] as const,
  launch: (q: { from?: string; to?: string }) => ["finance", "books", "launch", q] as const,
};

// ── money map & custody ───────────────────────────────────────────────────────────────────────────────────────────────

export interface MoneyMapAccount { id: string; name: string; kind: FinancialAccountKind; custodian: { id: string; name: string } | null; balance: number; clearing: boolean }
export interface MoneyMap {
  asOf: string;
  cashByPerson: Array<{ custodian: { id: string; name: string } | null; total: number; accounts: MoneyMapAccount[] }>;
  totals: {
    cash: number; bank: number; wallets: number; courierReceivable: number; courierChargesAccrued: number; gatewayReceivable: number; gatewayFeesAccrued: number;
    otherMoney: number; otherReceivable: number; adAccounts: number; inventory: number; workInProgress: number; prepaid: number; courierClaims: number; customerReceivables: number;
    suppliersOwed: number; goodsNotInvoiced: number; ownerToRepay: number; loans: number; storeCredit: number; vatOwed: number;
  };
  accounts: MoneyMapAccount[];
  equity: Array<{ code: string; name: string; balance: number }> | null;
}
export const getMoneyMap = (asOf?: string) => apiFetch<MoneyMap>(`${BASE}/money-map${qs({ asOf })}`);
export const setCustodian = (accountId: string, custodianAdminId: string | null) => apiFetch<{ id: string; custodianAdminId: string | null }>(`${BASE}/financial-accounts/${accountId}/custodian`, { method: "PUT", body: { custodianAdminId } });

export interface CashCount {
  id: string; financialAccount: { id: string; name: string }; countDate: string; counted: number; expected: number; difference: number; note: string | null; createdAt: string;
  adjustment: { id: string; status: Movement["status"] } | null;
}
export interface MyCustody {
  accounts: Array<{ id: string; name: string; balance: number }>;
  total: number;
  incoming: Movement[];
  outgoing: Movement[];
  counts: CashCount[];
  destinations: Array<{ id: string; name: string; kind: FinancialAccountKind; custodian: { id: string; name: string } | null }>;
  expenseAccounts: Array<{ id: string; code: string; name: string }>;
}
export const getMyCustody = () => apiFetch<MyCustody>(`${BASE}/custody/me`);
export const requestHandover = (body: { fromFinancialAccountId: string; toFinancialAccountId: string; amount: number; movementDate: string; description: string; reference?: string | null }, idempotencyKey: string) =>
  apiFetch<{ movement: Movement; replayed: boolean }>(`${BASE}/custody/handovers`, { method: "POST", body, idempotencyKey });
export const confirmHandover = (id: string) => apiFetch<{ movement: Movement }>(`${BASE}/custody/handovers/${id}/confirm`, { method: "POST", body: {} });
export const rejectHandover = (id: string, reason: string) => apiFetch<Movement>(`${BASE}/custody/handovers/${id}/reject`, { method: "POST", body: { reason } });
export const recordCashCount = (body: { financialAccountId: string; countDate: string; counted: number; note?: string | null }, idempotencyKey: string) =>
  apiFetch<{ count: CashCount; replayed: boolean }>(`${BASE}/custody/cash-counts`, { method: "POST", body, idempotencyKey });
export const custodyExpense = (body: { fromFinancialAccountId: string; expenseAccountId: string; amount: number; expenseDate?: string; description: string; payee?: string | null; reference?: string | null }, idempotencyKey: string) =>
  apiFetch<{ expense: { id: string; number: string; status: Movement["status"] } }>(`${BASE}/custody/expenses`, { method: "POST", body, idempotencyKey });
export const ownerPaidExpense = (body: { cashFinancialAccountId: string; expenseAccountId: string; amount: number; expenseDate?: string; description: string; payee?: string | null; reference?: string | null; funding: "REIMBURSE" | "CAPITAL"; partnerId?: string | null }, idempotencyKey: string) =>
  apiFetch<{ expense: { id: string; number: string; status: Movement["status"] } }>(`${BASE}/expenses/owner-paid`, { method: "POST", body, idempotencyKey });

// ── courier & gateway charges ─────────────────────────────────────────────────────────────────────────────────────────

export interface RateCardZone { name: string; districts: string[]; areas: string[]; charge: number }
export interface CourierRateCard { id: string; courier: string; effectiveFrom: string; zones: RateCardZone[]; defaultCharge: number; codPercent: number; returnChargePercent: number; notes: string | null; updatedAt: string }
export interface GatewayFeeRate { id: string; provider: "EPS_PG" | "SSLCOMMERZ"; effectiveFrom: string; percent: number; fixed: number; notes: string | null }
export const listRateCards = () => apiFetch<{ courierCards: CourierRateCard[]; gatewayRates: GatewayFeeRate[] }>(`${BASE}/rate-cards`);
export const saveRateCard = (body: Omit<CourierRateCard, "id" | "courier" | "updatedAt">) => apiFetch<CourierRateCard>(`${BASE}/rate-cards/courier`, { method: "PUT", body });
export const deleteRateCard = (id: string) => apiFetch<void>(`${BASE}/rate-cards/courier/${id}`, { method: "DELETE" });
export const saveGatewayRate = (body: Omit<GatewayFeeRate, "id">) => apiFetch<GatewayFeeRate>(`${BASE}/rate-cards/gateway`, { method: "PUT", body });
export const deleteGatewayRate = (id: string) => apiFetch<void>(`${BASE}/rate-cards/gateway/${id}`, { method: "DELETE" });

export interface CourierOrderRow { id: string; orderNumber: string; status: string; total: number; courierStatus: string | null; consignmentId: string | null; bookedOn: string | null; updatedOn: string; customerName: string }
export interface CourierReconciliation {
  asOf: string;
  books: { codClearing: number; chargesAccrued: number; expectedFromCourier: number };
  courier: { balance: number | null; error: string | null; difference: number | null };
  draftPayouts: Array<{ id: string; reference: string; date: string; net: number }>;
  unsettled: CourierOrderRow[];
  stale: CourierOrderRow[];
  statusMismatch: CourierOrderRow[];
  partialDeliveries: Array<CourierOrderRow & { paymentStatus: string; reconciled: boolean; settled: boolean }>;
  settings: { staleDays: number; unsettledDays: number; payoutAccountId: string | null };
}
export const getCourierReconciliation = () => apiFetch<CourierReconciliation>(`${BASE}/courier/reconciliation`);
export const importCourierPayouts = (destinationFinancialAccountId: string) =>
  apiFetch<{ listed: number; alreadyRecorded: number; imported: Array<{ id: string; reference: string; netAmount: number; lines: unknown[] }>; problems: Array<{ payoutId: string; message: string }>; unreadable: number }>(`${BASE}/courier/payouts/import`, { method: "POST", body: { destinationFinancialAccountId } });

// ── ads ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdCampaign {
  id: string; name: string; platform: string; externalId: string | null; objective: string | null; adAccount: { id: string; name: string }; isActive: boolean;
  startDate: string; endDate: string | null; budgetType: "DAILY" | "LIFETIME" | null; budget: number | null; landingPath: string | null; notes: string | null;
  period: { from: string; to: string }; spend: number; actualSpend: number; plannedSpend: number; orders: number; delivered: number; revenue: number;
  costPerOrder: number | null; roas: number | null; lastActualDay: string | null;
  foreignSpend?: Array<{ currency: string; amount: number }>; budgetHistory?: Array<{ from: string; budgetType: "DAILY" | "LIFETIME" | null; budget: number | null }>;
}
export const listCampaigns = (q: { from?: string; to?: string }) => apiFetch<{ period: { from: string; to: string }; campaigns: AdCampaign[]; totals: { spend: number; orders: number; revenue: number }; meta: { connected: boolean } }>(`${BASE}/ads/campaigns${qs(q)}`);
export const createCampaign = (body: Record<string, unknown>) => apiFetch<AdCampaign>(`${BASE}/ads/campaigns`, { method: "POST", body });
export const updateCampaign = (id: string, body: Record<string, unknown>) => apiFetch<AdCampaign>(`${BASE}/ads/campaigns/${id}`, { method: "PATCH", body });
export const recordDaySpend = (id: string, body: { date: string; amount?: number | null; originalAmount?: number | null; currency?: string | null; fxRate?: number | null }) => apiFetch<{ ok: true }>(`${BASE}/ads/campaigns/${id}/spend`, { method: "PUT", body });
export interface PeriodSpendResult { from: string; to: string; total: number; original: number | null; currency: string | null; rate: number | null; estimated: boolean; ownDays: number; ownTotal: number; sharedDays: number; shared: number }
/** A total for a stretch of days, shared over the days that have no figure of their own. */
export const recordPeriodSpend = (id: string, body: { from: string; to: string; amount?: number | null; originalAmount?: number | null; currency?: string | null; fxRate?: number | null }) => apiFetch<PeriodSpendResult>(`${BASE}/ads/campaigns/${id}/period-spend`, { method: "PUT", body });
export const importMetaSpend = (body: { days?: number; since?: string }) =>
  apiFetch<{ since: string; until: string; accounts: Array<{ adAccountId: string; financialAccount: string | null; days: number; campaigns: number; error: string | null }> }>(`${BASE}/ads/import-meta`, { method: "POST", body });

// ── prepaid costs ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PrepaidCost {
  id: string; number: string; name: string; expenseAccount: { id: string; code: string; name: string }; amount: number; serviceStart: string; serviceEnd: string;
  payee: string | null; reference: string | null; notes: string | null; paidFrom: { id: string; name: string } | null; paidOn: string; paymentStatus: Movement["status"]; movementId: string;
  remindDaysBefore?: number; renewalAmount?: number | null;
  used: number; remaining: number; daysLeft: number; perMonth: number; status: "AWAITING_PAYMENT" | "NOT_PAID" | "FINISHED" | "ENDING_SOON" | "RUNNING";
  schedule: Array<{ period: string; date: string; days: number; amount: number; booked: boolean }>;
}
export const listPrepaid = () => apiFetch<{ asOf: string; prepaid: PrepaidCost[]; totals: { remaining: number; endingSoon: number } }>(`${BASE}/prepaid`);
export const createPrepaid = (body: Record<string, unknown>, idempotencyKey: string) => apiFetch<{ prepaid: PrepaidCost; replayed: boolean }>(`${BASE}/prepaid`, { method: "POST", body, idempotencyKey });
export const updatePrepaid = (id: string, body: { name?: string; notes?: string | null; serviceEnd?: string; remindDaysBefore?: number; renewalAmount?: number | null }) => apiFetch<PrepaidCost>(`${BASE}/prepaid/${id}`, { method: "PATCH", body });

// ── packaging ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PackingScope = "EVERY_PARCEL" | "CATEGORY" | "PRODUCT" | "VARIANT";
export interface PackagingOverview {
  asOf: string;
  rules: Array<{ id: string; scope: PackingScope; scopeId: string | null; scopeName: string | null; quantity: number; per: "PARCEL" | "UNIT"; isActive: boolean; notes: string | null; createdOn: string; material: { id: string; sku: string; size: string; color: string; stock: number; product: { name: string; stockUnit: string | null } } }>;
  materials: Array<{ id: string; name: string; sku: string; size: string; color: string; unit: string | null; stock: number; usedLast30Days: number; perDay: number; daysLeft: number | null; runsOutOn: string | null; low: boolean }>;
}
export const getPackaging = () => apiFetch<PackagingOverview>(`${BASE}/packaging`);
export const createPackingRule = (body: { scope: PackingScope; scopeId?: string | null; materialVariantId: string; quantity: number; per: "PARCEL" | "UNIT"; notes?: string | null }) => apiFetch<{ id: string }>(`${BASE}/packaging/rules`, { method: "POST", body });
export const setPackingRuleActive = (id: string, isActive: boolean) => apiFetch<{ id: string }>(`${BASE}/packaging/rules/${id}`, { method: "PATCH", body: { isActive } });
export const syncOwnerBooks = () => apiFetch<{ packaging: { parcels: number; movements: number; short: Array<{ orderNumber: string; variantId: string; quantity: number }> } }>(`${BASE}/owner-books/sync`, { method: "POST", body: {} });

// ── landed costs & quick refills ──────────────────────────────────────────────────────────────────────────────────────

export interface LandedCost { id: string; number: string; costDate: string; description: string; payee: string | null; method: "QUANTITY" | "VALUE"; amount: number; allocations: Array<{ variantId: string; sku: string; qty: number; amount: number }>; paidFrom: { id: string; name: string } | null; paymentStatus: Movement["status"]; reversedAt: string | null; reversalReason: string | null }
export interface ReceiptChoice { id: string; number: string; receiptDate: string; supplier: string | null; units: number; value: number; lines: Array<{ sku: string; name: string; qty: number; unitCost: number }> }
export const listLandedCosts = () => apiFetch<{ landedCosts: LandedCost[] }>(`${BASE}/landed-costs`);
export const receiptsForLandedCost = () => apiFetch<{ receipts: ReceiptChoice[] }>(`${BASE}/landed-costs/receipts`);
export const createLandedCost = (body: Record<string, unknown>, idempotencyKey: string) => apiFetch<{ landedCost: LandedCost; replayed: boolean }>(`${BASE}/landed-costs`, { method: "POST", body, idempotencyKey });

export interface QuickRefill { id: string; number: string; status: string; product: string; variant: { sku: string; size: string } | null; quantity: number; cost: number | null; unitCost: number | null; materials: Array<{ sku: string; name: string; unit: string; used: number }>; date: string }
export const listQuickRefills = () => apiFetch<{ refills: QuickRefill[] }>(`${BASE}/quick-refills`);
export const quickRefill = (body: { variantId: string; quantity: number; used?: Array<{ materialVariantId: string; quantity: number }>; note?: string | null }, idempotencyKey: string) =>
  apiFetch<{ order: { id: string; number: string; finalCost: { goods: number; perAcceptedUnit: number | null } | null }; replayed: boolean }>(`${BASE}/quick-refills`, { method: "POST", body, idempotencyKey });

// ── profit ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ProfitReport {
  period: { from: string; to: string };
  totals: { orders: number; sales: number; cogs: number; packaging: number; courier: number; gateway: number; ads: number; contribution: number; contributionPct: number | null; outsideSales: number; outsideSalesCost: number; outsideSaleCostPct: number | null; otherCosts: number; netProfit: number };
  orders: Array<{ orderId: string; orderNumber: string; date: string; sales: number; cogs: number; packaging: number; courier: number; gateway: number; ads: number; contribution: number }>;
  products: Array<{ name: string; units: number; sales: number; costs: number; contribution: number; marginPct: number | null }>;
}
export const getProfit = (q: { from?: string; to?: string }) => apiFetch<ProfitReport>(`${BASE}/profit${qs(q)}`);
export interface LaunchReport { period: { from: string; to: string }; estimate: true; orders: { delivered: number; returned: number }; sales: number; cogs: number; courier: number; ads: number; contribution: number; courierRateCard: boolean; missingCost: Array<{ name: string; units: number }> }
export const getLaunchReport = (q: { from?: string; to?: string }) => apiFetch<LaunchReport>(`${BASE}/profit/launch${qs(q)}`);

// ── courier claims; cancelling a landed cost ──────────────────────────────────────────────────────────────────────────

export interface CourierClaim {
  id: string; number: string; orderId: string; orderNumber: string; consignmentId: string | null; claimDate: string; amount: number; received: number; outstanding: number; reason: string; status: "OPEN" | "SETTLED";
  settlements: Array<{ kind: "MONEY" | "PAYOUT" | "WRITE_OFF"; amount: number; date: string; note: string | null }>;
}
export const claimKeys = { all: ["finance", "books", "claims"] as const };
export const listClaims = () => apiFetch<{ claims: CourierClaim[]; totals: { outstanding: number } }>(`${BASE}/courier/claims`);
export const openClaim = (body: { orderId: string; amount: number; reason: string }) => apiFetch<CourierClaim>(`${BASE}/courier/claims`, { method: "POST", body });
export const settleClaim = (id: string, body: { kind: "MONEY" | "PAYOUT" | "WRITE_OFF"; amount: number; financialAccountId?: string | null; note?: string | null }, idempotencyKey: string) =>
  apiFetch<CourierClaim>(`${BASE}/courier/claims/${id}/settle`, { method: "POST", body, idempotencyKey });
export const cancelLandedCost = (id: string, reason: string) => apiFetch<LandedCost>(`${BASE}/landed-costs/${id}/cancel`, { method: "POST", body: { reason } });

/** A draft payout's parcels that match no order on the site are counted as sales outside the website. */
export const markOutsideSales = (settlementId: string) => apiFetch<{ id: string; unmatchedLines: number; outsideSaleLines: number }>(`${BASE}/settlements/${settlementId}/outside-sales`, { method: "POST", body: {} });

// ── Finance Center (docs/FINANCE_CENTER.md) ───────────────────────────────────────────────────────────────────────────

export type EntryVerification = "CONFIRMED" | "ESTIMATED" | "NEEDS_CHECK" | "DISPUTED";
export type VerifiableType = "Expense" | "PrepaidCost" | "FixedAsset" | "OpeningBalanceLine" | "OpeningInventoryItem" | "LandedCost" | "TreasuryMovement" | "AdSpendDay";
export const centerKeys = {
  summary: () => ["finance", "center", "summary"] as const,
  verifications: (status?: EntryVerification) => ["finance", "center", "verifications", status ?? "open"] as const,
  allocations: () => ["finance", "center", "allocations"] as const,
  renewals: () => ["finance", "center", "renewals"] as const,
  sms: () => ["finance", "center", "sms"] as const,
  settings: () => ["finance", "center", "settings"] as const,
  autopilot: () => ["finance", "center", "autopilot"] as const,
};
export interface CenterSummary {
  asOf: string;
  owner: { capital: number; openingEquity: number; ownerPaidNotRepaid: number; drawings: number; netInvested: number };
  verification: Partial<Record<EntryVerification, { count: number; amount: number }>>;
  missing: Array<{ key: string; title: string; detail: string; count: number; href: string }>;
}
export interface VerificationItem { entityType: VerifiableType; entityId: string; status: EntryVerification; source: string | null; note: string | null; label: string; date: string | null; amount: number; updatedAt: string }
export interface AwaitingExpense {
  id: string; number: string; expenseDate: string; description: string; payee: string | null; paidFrom: { id: string; name: string } | null; paymentStatus: Movement["status"];
  amount: number; allocated: number; remaining: number; status: "NOT_ALLOCATED" | "PARTLY_ALLOCATED" | "ALLOCATED";
  lines: Array<{ lineNo: number; account: { id: string; code: string; name: string }; productId: string | null; productName: string | null; amount: number; note: string | null }>;
}
export interface Renewal {
  id: string; name: string; payee: string | null; account: { code: string; name: string }; amount: number; serviceStart: string; serviceEnd: string; remindDaysBefore: number; renewalAmount: number | null;
  verification: EntryVerification; renewed: boolean; remindOn: string; status: "ACTIVE" | "RENEW_SOON" | "EXPIRED" | "RENEWED"; daysToEnd: number;
}
export interface SmsStatus {
  provider: { read: boolean; reason?: string }; balance: number | null; readAt: string | null; readSource: string | null; lowBalance: number | null; isLow: boolean;
  usedPerDay: number | null; daysLeft: number | null; runsOutOn: string | null; monthlyUsage: Array<{ month: string; used: number }>;
  recharges: Array<{ id: string; date: string; amount: number; payee: string | null; description: string }>; readings: Array<{ at: string; balance: number; source: string; note: string | null }>; smsAccountId: string | null;
}
export interface CenterSettings { defaultUsdRate: number | null; smsLowBalance: number | null; outsideSaleCostPct: number | null }
export const getCenterSummary = () => apiFetch<CenterSummary>(`${BASE}/center/summary`);
export const listVerifications = (status?: EntryVerification) => apiFetch<{ items: VerificationItem[]; totals: CenterSummary["verification"] }>(`${BASE}/center/verifications${qs({ status })}`);
export const setVerification = (body: { entityType: VerifiableType; entityId: string; status: EntryVerification; source?: string | null; note?: string | null }) => apiFetch<{ status: EntryVerification }>(`${BASE}/center/verifications`, { method: "PUT", body });
export const listAwaitingAllocation = () => apiFetch<{ accountId: string | null; expenses: AwaitingExpense[]; remaining: number }>(`${BASE}/center/allocations`);
export const setAllocations = (expenseId: string, lines: Array<{ accountId: string; productId?: string | null; amount: number; note?: string | null }>) => apiFetch<AwaitingExpense>(`${BASE}/center/allocations/${expenseId}`, { method: "PUT", body: { lines } });
export const listRenewals = () => apiFetch<{ renewals: Renewal[] }>(`${BASE}/center/renewals`);
export const getSmsStatus = () => apiFetch<SmsStatus>(`${BASE}/center/sms`);
export const recordSmsBalance = (body: { balance: number; takenAt?: string; note?: string | null }) => apiFetch<{ id: string }>(`${BASE}/center/sms/balance`, { method: "POST", body });
export const getCenterSettings = () => apiFetch<CenterSettings>(`${BASE}/center/settings`);
export const updateCenterSettings = (body: Partial<CenterSettings>) => apiFetch<CenterSettings>(`${BASE}/center/settings`, { method: "PATCH", body });

/** Autopilot (docs/FINANCE_OWNER_BOOKS.md §15): what runs by itself every morning and evening. */
export interface AutopilotStep { ok: boolean; skipped?: string; error?: string; imported?: number; posted?: string[]; waiting?: Array<{ reference: string; parcels: number }>; problems?: Array<{ payoutId: string; message: string }>; taken?: number; amount?: number; days?: number; shared?: Array<{ partner: string; period: string; amount: number }>; months?: string[] }
export interface AutopilotRun { at: string; payouts: AutopilotStep; ownerDrawings: AutopilotStep; adSpend: AutopilotStep; depreciation?: AutopilotStep; profitShares: AutopilotStep }
export interface AutopilotSettings { payoutAccount: { id: string; name: string; kind: string } | null; payoutsToOwner: boolean; profitShares: boolean; metaConnected: boolean; lastRun: AutopilotRun | null }
export const getAutopilot = () => apiFetch<AutopilotSettings>(`${BASE}/center/autopilot`);
export const updateAutopilot = (body: { payoutAccountId?: string | null; payoutsToOwner?: boolean; profitShares?: boolean }) => apiFetch<AutopilotSettings>(`${BASE}/center/autopilot`, { method: "PATCH", body });
export const runAutopilot = () => apiFetch<AutopilotRun>(`${BASE}/center/autopilot/run`, { method: "POST" });

export interface AdCsvPreview {
  committed: boolean; rows: number; errors: Array<{ line: number; error: string }>; newCampaigns: string[]; new: number; replace: number; same: number; total: number; estimated: number;
  lines: Array<{ line: number; date: string; campaign: string; spend: number; currency: string; amount: number; estimated: boolean; action: "NEW" | "REPLACE" | "SAME"; previous: number | null }>;
}
export const importAdCsv = (body: { financialAccountId: string; csv: string; currency?: string | null; fxRate?: number | null; commit: boolean }) => apiFetch<AdCsvPreview>(`${BASE}/ads/import-csv`, { method: "POST", body });

// ── Stock check: where every unit went, counts and rolls (docs/FINANCE_CENTER.md §7) ──────────────────────────────────

export type StockBuckets = { delivered: number; partly: number; returned: number; onTheWay: number; waiting: number; cancelled: number; refunded: number };
export type StockCountResult = { date: string; counted: number; siteStockThen: number; difference: number } | null;
export interface StockCheckFinished {
  variantId: string; productId: string; product: string; category: string | null; size: string; color: string; sku: string;
  stock: number; out: StockBuckets; throughSite: number; cameInOnDocument: number; typedIn: number; editsWithoutReason: number; count: StockCountResult;
}
export interface StockCheckMaterial {
  variantId: string; productId: string; product: string; size: string; color: string; sku: string; unit: string;
  stock: number; cameInOnDocument: number; usedOnRecord: number; usedByRecipes: number | null; finishedUnits: number | null; boughtAtLeast: number | null; boughtBasis: "count" | "stock"; unitCost: number | null; count: StockCountResult;
}
export interface StockCheck {
  asOf: string;
  finished: StockCheckFinished[];
  materials: StockCheckMaterial[];
  directShipments: Array<{ reference: string; date: string; status: string; parcels: number; amount: number; outsideSale: number }>;
  checks: { shippedWithoutCourier: number; partlyUnsettled: number; returnedNotRestocked: number; recipes: number };
}
export interface MaterialRollRow {
  id: string; material: string; materialVariantId: string; openedOn: string; finishedOn: string | null; note: string | null;
  parcelsBooked: number; parcelsCounted: number | null; parcels: number; rollCost: number | null; perParcel: number | null;
}
export const stockCheckKeys = {
  report: () => ["finance", "center", "stock-check"] as const,
  rolls: () => ["finance", "center", "rolls"] as const,
};
export const getStockCheck = () => apiFetch<StockCheck>(`${BASE}/center/stock-check`);
export const recordStockCount = (body: { variantId: string; counted: number; countDate?: string; note?: string | null }) => apiFetch<{ id: string; difference: number }>(`${BASE}/center/stock-counts`, { method: "POST", body });
export const listRolls = () => apiFetch<{ rolls: MaterialRollRow[]; averagePerParcel: number | null }>(`${BASE}/center/rolls`);
export const openRoll = (body: { materialVariantId: string; openedOn: string; note?: string | null }) => apiFetch<{ id: string }>(`${BASE}/center/rolls`, { method: "POST", body });
export const finishRoll = (id: string, body: { finishedOn: string; parcelsCounted?: number | null; note?: string | null }) => apiFetch<{ id: string }>(`${BASE}/center/rolls/${id}/finish`, { method: "POST", body });

// ── the owner's home (docs/FINANCE_OWNER_HOME.md) ─────────────────────────────────────────────────────────────────────

/** A month in the owner's words: sales, and where it went. Costs are positive; profit can be negative. */
export interface OwnerMonth { month: string; from: string; to: string; sales: number; goods: number; delivery: number; ads: number; other: number; profit: number }
export type OwnerTodoKind = "BOOKS_NOT_STARTED" | "PAYOUT_WAITING" | "PAY_PARTNER" | "RENEW_SOON" | "EXPIRED" | "APPROVE_MONEY";
export interface OwnerHome {
  currency: string;
  today: string;
  booksStarted: boolean;
  month: OwnerMonth;
  lastMonth: OwnerMonth;
  money: {
    withUs: { cash: number; bank: number; wallets: number; total: number };
    owedToUs: { courier: number; gateways: number; customers: number };
    inBusiness: { stock: number; prepaid: number; adAccounts: number };
    weOwe: { suppliers: number; owner: number; loans: number; storeCredit: number };
  };
  /** Only for the owner. */
  people: null | {
    owner: { name: string; putIn: number; takenOut: number; inBusiness: number } | null;
    partners: Array<{ id: string; name: string; sharePct: number | null; owed: number; earned: number; paid: number; runningMonth: { period: string; profitSoFar: number; shareSoFar: number } | null }>;
  };
  todo: Array<{ kind: OwnerTodoKind; count?: number; amount?: number; name?: string; date?: string; partnerId?: string; href: string }>;
}
export const ownerHomeKey = (month?: string) => ["finance", "owner-home", month ?? "now"] as const;
export const getOwnerHome = (month?: string) => apiFetch<OwnerHome>(`${BASE}/owner-home${month ? `?month=${month}` : ""}`);
