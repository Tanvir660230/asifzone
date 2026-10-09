/**
 * Financial Core admin API (/api/v1/finance — docs/FINANCE_PHASE_1.md §6, docs/FINANCE_PHASE_2.md §7). Money in major
 * units. Money movements and hand-entered statement lines carry an Idempotency-Key (lib/idempotency.ts).
 */
import { apiFetch } from "../api-client";

const BASE = "/api/v1/finance";
const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

export type FinancialAccountKind = "CASH" | "BANK" | "MOBILE_WALLET" | "PAYMENT_GATEWAY" | "COURIER" | "OTHER";

export interface FinancialAccount {
  id: string;
  kind: FinancialAccountKind;
  name: string;
  provider: string | null;
  accountNumberLast4: string | null;
  accountTitle: string | null;
  branch: string | null;
  accountReference: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  approvalThreshold: number | null;
  currency: string;
  brandId: string | null;
  isActive: boolean;
  status: "ACTIVE" | "INACTIVE";
  ledgerAccount: { id: string; code: string; name: string };
  currentBalance: number;
  openingBalance: number;
  reconciliationStartDate: string | null;
  lastReconciledThrough: string | null;
  pendingMovements: number;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerAccountSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  isPostable: boolean;
  isActive: boolean;
}

export type MovementKind = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER" | "ADJUSTMENT" | "OPENING_FUNDING" | "SUPPLIER_PAYMENT";
export type MovementStatus = "PENDING_APPROVAL" | "POSTED" | "REJECTED" | "REVERSED";

export interface Movement {
  id: string;
  kind: MovementKind;
  status: MovementStatus;
  direction: "IN" | "OUT" | null;
  movementDate: string;
  amount: number;
  currency: string;
  fromAccount: { id: string; name: string; kind: FinancialAccountKind } | null;
  toAccount: { id: string; name: string; kind: FinancialAccountKind } | null;
  counterAccount: { id: string; code: string; name: string } | null;
  reference: string | null;
  description: string;
  reason: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  requestedByAdminId: string | null;
  approvedByAdminId: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  createdAt: string;
}

export type BankTransactionStatus = "UNMATCHED" | "PARTIALLY_MATCHED" | "MATCHED" | "ADJUSTMENT_REQUIRED" | "RECONCILED";

export interface BankMatch {
  id: string;
  status: "ACTIVE" | "REMOVED";
  amount: number;
  journalLineId: string;
  journalEntry: { id: string; number: number | null; entryDate: string; description: string; kind: string };
  matchedAt: string;
  adjustmentMovementId: string | null;
  removedAt: string | null;
  removalReason: string | null;
}

export interface BankTransaction {
  id: string;
  financialAccountId: string;
  transactionDate: string;
  valueDate: string | null;
  reference: string | null;
  description: string;
  debit: number;
  credit: number;
  amount: number;
  externalId: string | null;
  statementBalance: number | null;
  source: "MANUAL" | "CSV_IMPORT";
  status: BankTransactionStatus;
  matchedAmount: number;
  unmatchedAmount: number;
  adjustmentRequired: boolean;
  note: string | null;
  reconciliationId: string | null;
  matches: BankMatch[];
}

export interface LedgerLine {
  entryId: string;
  number: number | null;
  entryDate: string;
  kind: string;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export interface MatchCandidate {
  journalLineId: string;
  entryId: string;
  number: number | null;
  entryDate: string;
  kind: string;
  description: string;
  memo: string | null;
  debit: number;
  credit: number;
  remaining: number;
  exactAmount: boolean;
  dayDistance: number;
}

export interface Reconciliation {
  id: string;
  financialAccountId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  periodStart: string;
  periodEnd: string;
  openingStatementBalance: number;
  closingStatementBalance: number;
  ledgerOpeningBalance: number | null;
  ledgerBalance: number | null;
  statementMovement: number | null;
  difference: number | null;
  unexplainedDifference: number | null;
  statementGap: number | null;
  matchedCount: number;
  unmatchedCount: number;
  outstandingLedgerCount: number;
  adjustmentCount: number;
  notes: string | null;
  completedAt: string | null;
  abandonedAt: string | null;
  abandonReason: string | null;
  createdAt: string;
}

export interface ReconciliationDetail {
  reconciliation: Reconciliation;
  live: {
    ledgerOpeningBalance: number;
    ledgerBalance: number;
    statementMovement: number;
    difference: number;
    unexplainedDifference: number;
    statementGap: number;
    outstandingLedgerNet: number;
    unmatchedStatementNet: number;
    matchedCount: number;
    unmatchedCount: number;
    outstandingLedgerCount: number;
    adjustmentCount: number;
    earlierUnreconciledLines: number;
    canComplete: boolean;
  } | null;
  statementLines: BankTransaction[];
  outstandingLedgerLines: Array<Omit<MatchCandidate, "exactAmount" | "dayDistance">>;
}

export interface StatementMapping {
  date: string;
  valueDate?: string;
  description?: string;
  reference?: string;
  debit?: string;
  credit?: string;
  amount?: string;
  balance?: string;
  externalId?: string;
}

export interface StatementOptions {
  dateFormat: string;
  amountConvention: "POSITIVE_IS_MONEY_IN" | "POSITIVE_IS_MONEY_OUT";
  hasHeader: boolean;
  skipRows: number;
}

export interface StatementImportInput {
  financialAccountId: string;
  fileName?: string | null;
  csv: string;
  mapping: StatementMapping;
  options: StatementOptions;
}

export interface StatementPreview {
  header: string[] | null;
  rowCount: number;
  newRows: number;
  duplicateRows: number;
  errors: Array<{ line: number; message: string }>;
  rows: Array<{ line: number; transactionDate: string; description: string; reference: string | null; debit: number; credit: number; balance: number | null; duplicate: boolean }>;
}

export interface StatementImport {
  id: string;
  fileName: string | null;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: Array<{ line: number; message: string }>;
  createdAt: string;
}

// ── accounts ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const listFinancialAccounts = () => apiFetch<{ financialAccounts: FinancialAccount[] }>(`${BASE}/financial-accounts`);
export const getFinancialAccount = (id: string) => apiFetch<FinancialAccount>(`${BASE}/financial-accounts/${id}`);
export const getAccountLedger = (id: string, range: { from?: string; to?: string } = {}) =>
  apiFetch<{ openingBalance: number; closingBalance: number; lines: LedgerLine[]; truncated: boolean }>(`${BASE}/financial-accounts/${id}/ledger${qs(range)}`);
export const createFinancialAccount = (body: Record<string, unknown>) => apiFetch<FinancialAccount & { openingMovement: Movement | null }>(`${BASE}/financial-accounts`, { method: "POST", body });
export const updateFinancialAccount = (id: string, body: Record<string, unknown>) => apiFetch<FinancialAccount>(`${BASE}/financial-accounts/${id}`, { method: "PATCH", body });
export const listLedgerAccounts = () => apiFetch<{ accounts: LedgerAccountSummary[] }>(`${BASE}/accounts`);

// ── movements ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const MOVEMENT_PATH: Record<Exclude<MovementKind, "OPENING_FUNDING" | "SUPPLIER_PAYMENT">, string> = { DEPOSIT: "deposit", WITHDRAWAL: "withdrawal", TRANSFER: "transfer", ADJUSTMENT: "adjustment" };
export const requestMovement = (kind: Exclude<MovementKind, "OPENING_FUNDING" | "SUPPLIER_PAYMENT">, body: Record<string, unknown>, idempotencyKey: string) =>
  apiFetch<{ movement: Movement; replayed: boolean }>(`${BASE}/movements/${MOVEMENT_PATH[kind]}`, { method: "POST", body, idempotencyKey });
export const listMovements = (q: { financialAccountId?: string; status?: MovementStatus; page?: number; pageSize?: number }) =>
  apiFetch<{ total: number; movements: Movement[] }>(`${BASE}/movements${qs(q)}`);
export const approveMovement = (id: string) => apiFetch<{ movement: Movement }>(`${BASE}/movements/${id}/approve`, { method: "POST", body: {} });
export const rejectMovement = (id: string, reason: string) => apiFetch<Movement>(`${BASE}/movements/${id}/reject`, { method: "POST", body: { reason } });
export const reverseMovement = (id: string, reason: string) => apiFetch<{ movement: Movement }>(`${BASE}/movements/${id}/reverse`, { method: "POST", body: { reason } });

// ── statement lines & matching ──────────────────────────────────────────────────────────────────────────────────────
export const listBankTransactions = (q: { financialAccountId?: string; status?: BankTransactionStatus; page?: number; pageSize?: number }) =>
  apiFetch<{ total: number; bankTransactions: BankTransaction[] }>(`${BASE}/bank-transactions${qs(q)}`);
export const createBankTransaction = (body: Record<string, unknown>, idempotencyKey: string) =>
  apiFetch<{ bankTransaction: BankTransaction; replayed: boolean }>(`${BASE}/bank-transactions`, { method: "POST", body, idempotencyKey });
export const matchCandidates = (id: string) => apiFetch<{ candidates: MatchCandidate[] }>(`${BASE}/bank-transactions/${id}/candidates`);
export const matchBankTransaction = (id: string, body: { journalLineId: string; amount?: number; reconciliationId?: string | null }) =>
  apiFetch<BankTransaction>(`${BASE}/bank-transactions/${id}/match`, { method: "POST", body });
export const unmatch = (matchId: string, reason: string) => apiFetch<BankTransaction>(`${BASE}/bank-matches/${matchId}/unmatch`, { method: "POST", body: { reason } });
export const flagBankTransaction = (id: string, adjustmentRequired: boolean, note?: string) =>
  apiFetch<BankTransaction>(`${BASE}/bank-transactions/${id}/flag`, { method: "POST", body: { adjustmentRequired, note } });
export const adjustBankTransaction = (id: string, body: { counterAccountId: string; reason: string; reconciliationId?: string | null }) =>
  apiFetch<{ movement: Movement; bankTransaction: BankTransaction }>(`${BASE}/bank-transactions/${id}/adjust`, { method: "POST", body });

// ── statement import ────────────────────────────────────────────────────────────────────────────────────────────────
export const previewStatementImport = (body: StatementImportInput) => apiFetch<StatementPreview>(`${BASE}/statement-imports/preview`, { method: "POST", body });
export const importStatement = (body: StatementImportInput) => apiFetch<{ import: StatementImport; replayed: boolean }>(`${BASE}/statement-imports`, { method: "POST", body });

// ── reconciliation ──────────────────────────────────────────────────────────────────────────────────────────────────
export const listReconciliations = (q: { financialAccountId?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; reconciliations: Reconciliation[] }>(`${BASE}/bank-reconciliations${qs(q)}`);
export const getReconciliation = (id: string) => apiFetch<ReconciliationDetail>(`${BASE}/bank-reconciliations/${id}`);
export const startReconciliation = (body: { financialAccountId: string; periodStart: string; periodEnd: string; openingStatementBalance: number; closingStatementBalance: number }) =>
  apiFetch<Reconciliation>(`${BASE}/bank-reconciliations`, { method: "POST", body });
export const autoMatch = (id: string) => apiFetch<{ matched: number }>(`${BASE}/bank-reconciliations/${id}/auto-match`, { method: "POST", body: {} });
export const completeReconciliation = (id: string, notes: string) => apiFetch<Reconciliation>(`${BASE}/bank-reconciliations/${id}/complete`, { method: "POST", body: { notes } });
export const abandonReconciliation = (id: string, reason: string) => apiFetch<Reconciliation>(`${BASE}/bank-reconciliations/${id}/abandon`, { method: "POST", body: { reason } });

export const financeKeys = {
  all: ["finance"] as const,
  accounts: () => ["finance", "accounts"] as const,
  account: (id: string) => ["finance", "accounts", id] as const,
  ledgerAccounts: () => ["finance", "ledger-accounts"] as const,
  reconciliations: () => ["finance", "reconciliations"] as const,
  reconciliation: (id: string) => ["finance", "reconciliations", id] as const,
};

export const ACCOUNT_KIND_LABEL: Record<FinancialAccountKind, string> = {
  CASH: "Cash",
  BANK: "Bank",
  MOBILE_WALLET: "Mobile wallet",
  PAYMENT_GATEWAY: "Payment gateway",
  COURIER: "Courier COD",
  OTHER: "Other",
};

// ── Phase 3: commerce accounting, exceptions, settlements, checks (docs/FINANCE_PHASE_3.md §7) ──────────────────────

export interface CommerceStatus {
  openingDate: string | null;
  cursor: string | null;
  lastRunAt: string | null;
  lastRunStats: Record<string, unknown> | null;
  readiness: { ready: boolean; missing: string[] };
  events: Record<string, number>;
  eventsByType: Array<{ type: string; status: string; count: number }>;
}
export interface FinanceException {
  id: string;
  kind: string;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  title: string;
  sourceType: string;
  sourceId: string;
  orderId: string | null;
  orderNumber: string | null;
  amount: number | null;
  details: Record<string, unknown>;
  resolution: string | null;
  resolutionNote: string | null;
  estimatedUnitCost: number | null;
  createdAt: string;
}
export interface Settlement {
  id: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  source: "MANUAL" | "CSV_IMPORT";
  reference: string;
  evidence: string | null;
  settlementDate: string;
  clearingAccount: { id: string; name: string; kind: string };
  destinationAccount: { id: string; name: string; kind: string };
  grossAmount: number;
  netAmount: number;
  feeAmount: number;
  adjustmentAmount: number;
  adjustmentReason: string | null;
  unmatchedLines: number;
  lines: Array<{ id: string; lineNo: number; orderId: string | null; orderNumber: string | null; externalRef: string | null; amount: number; fee: number; adjustment: number; matchStatus: "MATCHED" | "UNMATCHED" }>;
}
export interface CheckResult {
  id: string;
  checkKey: string;
  status: "MATCHED" | "DIFFERENCE" | "NOT_APPLICABLE" | "ERROR";
  expected: number | null;
  actual: number | null;
  difference: number | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export const commerceStatus = () => apiFetch<CommerceStatus>(`${BASE}/commerce/status`);
export interface SyncStats { skipped?: string; missingMappings?: string[]; orders: number; customerCredits: number; stockExceptions: number; recorded: number; posted: number; failed: number }
export const syncCommerce = (full = false) => apiFetch<SyncStats>(`${BASE}/commerce/sync`, { method: "POST", body: { full } });
export const orderAccounting = (orderId: string) =>
  apiFetch<{ orderId: string; events: Array<{ id: string; eventType: string; eventKey: string; status: string; financialDate: string; lastError: string | null; journalEntry: { id: string; number: number | null; reversedBy: { number: number | null } | null } | null }>; exceptions: FinanceException[] }>(`${BASE}/commerce/orders/${orderId}`);

export const listExceptions = (q: { status?: string; kind?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; openByKind: Record<string, number>; exceptions: FinanceException[] }>(`${BASE}/exceptions${qs(q)}`);
export const acknowledgeException = (id: string, note: string) => apiFetch<FinanceException>(`${BASE}/exceptions/${id}/acknowledge`, { method: "POST", body: { note } });
export const approveEstimate = (id: string, unitCost: number, note: string) => apiFetch<{ outcomes: Record<string, string> }>(`${BASE}/exceptions/${id}/approve-estimate`, { method: "POST", body: { unitCost, note } });
export const getBusiness = () => apiFetch<{ costPolicy: "KNOWN_ONLY" | "APPROVED_ESTIMATES"; business: { openingDate: string | null } }>(`${BASE}/business`);
export const setCostPolicy = (costPolicy: "KNOWN_ONLY" | "APPROVED_ESTIMATES", reason: string) => apiFetch(`${BASE}/business/cost-policy`, { method: "PUT", body: { costPolicy, reason } });

export const listSettlements = (q: { status?: string; page?: number; pageSize?: number } = {}) => apiFetch<{ total: number; settlements: Settlement[] }>(`${BASE}/settlements${qs(q)}`);
export const createSettlement = (body: Record<string, unknown>, idempotencyKey: string) => apiFetch<{ settlement: Settlement; replayed: boolean }>(`${BASE}/settlements`, { method: "POST", body, idempotencyKey });
export const importSettlement = (body: Record<string, unknown>) => apiFetch<{ settlement: Settlement; replayed: boolean }>(`${BASE}/settlements/import`, { method: "POST", body });
export const postSettlement = (id: string) => apiFetch<{ settlement: Settlement }>(`${BASE}/settlements/${id}/post`, { method: "POST", body: {} });
export const reverseSettlement = (id: string, reason: string) => apiFetch<{ settlement: Settlement }>(`${BASE}/settlements/${id}/reverse`, { method: "POST", body: { reason } });
export const deleteSettlement = (id: string) => apiFetch<void>(`${BASE}/settlements/${id}`, { method: "DELETE" });
export const clearingPosition = (financialAccountId: string) =>
  apiFetch<{ account: { id: string; name: string; kind: string }; balance: number; openOrders: Array<{ orderId: string; orderNumber: string | null; orderStatus: string | null; received: number; settled: number; open: number }>; oversettled: unknown[]; unattributed: unknown[] }>(`${BASE}/clearing/${financialAccountId}`);

export const reconciliationChecks = () => apiFetch<{ checks: Array<{ key: string; label: string; description: string }> }>(`${BASE}/reconciliation/checks`);
export const runChecks = (checks?: string[]) => apiFetch<{ ok: boolean; results: CheckResult[] }>(`${BASE}/reconciliation/run`, { method: "POST", body: checks ? { checks } : {} });

export const CLEARING_KINDS = new Set<FinancialAccountKind>(["COURIER", "PAYMENT_GATEWAY", "OTHER"]);
export const listCheckRuns = (q: { checkKey?: string; page?: number; pageSize?: number } = {}) => apiFetch<{ total: number; runs: CheckResult[] }>(`${BASE}/reconciliation/runs${qs(q)}`);

// ── Phase 4C: the valuation cutover (docs/FINANCE_PHASE_4C.md) ────────────────────────────────────────────────────────
export type CutoverStatus = "DRAFT" | "APPROVED" | "POSTED";
export type CutoverValuationStatus = "KNOWN" | "ESTIMATED" | "MISSING";
export type CutoverCostSource = "OPENING_COUNT" | "CATALOG_VARIANT" | "CATALOG_PRODUCT" | "OWNER" | "SUPPLIER_INVOICE" | "NONE" | "ADDED_AT_POST";
export interface CutoverBatch {
  id: string;
  status: CutoverStatus;
  cutoverDate: string;
  notes: string | null;
  openingErrorAmount: number;
  openingErrorReason: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  journalEntryId: string | null;
  summary: null | { variants: number; addedAtPost: number; known: number; estimated: number; missing: number; unvaluedUnits: number; ledgerBefore: number; valuation: number; inTransit: number; adjustment: number; toOpeningBalanceEquity: number; toCostAdjustments: number; activatedAt: string };
}
export interface CutoverSummary { lines: number; known: number; estimated: number; missing: number; missingUnits: number; draftValuation: number }
export interface CutoverOverview {
  batch: CutoverBatch | null;
  summary: CutoverSummary | null;
  preview: { ledger: number; valuation: number; inTransit: number; inTransitOrders: number; adjustment: number } | null;
  prerequisites: { openingDateSet: boolean; openingBalancesPosted: boolean; costingActive: boolean };
  costingActivatedAt: string | null;
}
export interface CutoverLine {
  id: string;
  variantId: string;
  sku: string;
  name: string;
  unitCost: number | null;
  valuationStatus: CutoverValuationStatus;
  costSource: CutoverCostSource;
  evidence: string | null;
  draftQuantity: number;
  postedQuantity: number | null;
  postedValue: number | null;
}
export interface CutoverLineInput { variantId: string; unitCost: number | null; valuationStatus: CutoverValuationStatus; costSource: Exclude<CutoverCostSource, "ADDED_AT_POST">; evidence?: string | null }

export const getCutover = () => apiFetch<CutoverOverview>(`${BASE}/inventory-cutover`);
export const listCutoverLines = (q: { status?: CutoverValuationStatus; search?: string; page?: number; pageSize?: number }) =>
  apiFetch<{ total: number; page: number; pageSize: number; lines: CutoverLine[] }>(`${BASE}/inventory-cutover/lines${qs(q)}`);
export const draftCutover = (notes?: string | null) => apiFetch<{ batch: CutoverBatch; summary: CutoverSummary }>(`${BASE}/inventory-cutover`, { method: "POST", body: notes === undefined ? {} : { notes } });
export const updateCutoverSettings = (body: { notes?: string | null; openingErrorAmount?: number; openingErrorReason?: string | null }) => apiFetch<CutoverBatch>(`${BASE}/inventory-cutover`, { method: "PATCH", body });
export const updateCutoverLines = (lines: CutoverLineInput[]) => apiFetch<{ updated: number; summary: CutoverSummary }>(`${BASE}/inventory-cutover/lines`, { method: "PATCH", body: { lines } });
export const approveCutover = (acknowledgeMissing: boolean) => apiFetch<{ batch: CutoverBatch; summary: CutoverSummary }>(`${BASE}/inventory-cutover/approve`, { method: "POST", body: { acknowledgeMissing } });
export const reopenCutover = (reason: string) => apiFetch<CutoverBatch>(`${BASE}/inventory-cutover/reopen`, { method: "POST", body: { reason } });
export const postCutover = () => apiFetch<{ batch: CutoverBatch; replayed: boolean }>(`${BASE}/inventory-cutover/post`, { method: "POST", body: {} });

// ── ERP E6: chart, journals, trial balance, statements (docs/FINANCE_STATEMENTS.md) ─────────────────────────────────────
export type LedgerAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "COGS" | "EXPENSE" | "OTHER_INCOME" | "OTHER_EXPENSE";
export interface ChartAccount {
  id: string; code: string; name: string; description: string | null; type: LedgerAccountType; normalBalance: "DEBIT" | "CREDIT";
  parentId: string | null; isPostable: boolean; isSystem: boolean; isActive: boolean; isSensitive: boolean; mappings: string[];
  balance: number | null; restricted: boolean;
}
export interface JournalEntry {
  id: string; number: number | null; status: "DRAFT" | "POSTED"; kind: "MANUAL" | "OPENING_BALANCE" | "EVENT" | "REVERSAL" | "CORRECTION" | "TREASURY" | "ADJUSTMENT";
  entryDate: string; description: string; reference: string | null; brandId: string | null; totalDebit: number; totalCredit: number;
  sourceType: string | null; sourceId: string | null; reversesEntryId: string | null; correctsEntryId: string | null; reason: string | null; postedAt: string | null; createdAt: string;
  reversedBy?: unknown; correctedBy?: unknown;
  lines: Array<{ id: string; lineNo: number; accountId: string; debit: number; credit: number; memo: string | null; partyType: string | null; partyId: string | null }>;
}
export interface AccountLedger {
  account: { id: string; code: string; name: string; type: LedgerAccountType; normalBalance: "DEBIT" | "CREDIT" };
  openingBalance: number; closingBalance: number; truncated: boolean;
  lines: Array<{ entryId: string; number: number; entryDate: string; kind: string; description: string; reference: string | null; lineNo: number; debit: number; credit: number; memo: string | null; balance: number }>;
}
export interface TrialBalance {
  currency: string; range: { from: string | null; to: string | null };
  rows: Array<{ accountId: string; code: string; name: string; type: string; opening: number | null; periodDebit: number | null; periodCredit: number | null; closingDebit: number; closingCredit: number; balance: number | null }>;
  totalDebit: number; totalCredit: number; balanced: boolean;
}
export interface StatementSection { key: string; label: string; total: number; lines: Array<{ accountId: string | null; code: string; name: string; group: string; amount: number }> }
export interface ProfitAndLoss { sections: StatementSection[]; grossProfit: number; operatingProfit: number; netProfit: number; grossMarginPct: number | null }
export interface IncomeStatement { period: { from: string; to: string }; prior: { from: string; to: string }; current: ProfitAndLoss; priorPeriod: ProfitAndLoss }
export interface BalanceSheet { asOf: string; sections: StatementSection[]; totalAssets: number; totalLiabilitiesAndEquity: number; balanced: boolean }
export interface CashFlow { period: { from: string; to: string }; netProfit: number; sections: StatementSection[]; operatingCashFlow: number; netChange: number; money: { opening: number; change: number; closing: number }; reconciles: boolean }

const range = (q: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as Array<[string, string]>).toString();
  return s ? `?${s}` : "";
};
export const ledgerKeys = {
  chart: () => ["finance", "chart"] as const,
  ledger: (id: string, q: object) => ["finance", "ledger", id, q] as const,
  journals: (q: object) => ["finance", "journals", q] as const,
  trialBalance: (q: object) => ["finance", "trial-balance", q] as const,
  statement: (kind: string, q: object) => ["finance", "statements", kind, q] as const,
};
export const listChart = () => apiFetch<{ accounts: ChartAccount[] }>(`${BASE}/accounts`);
export const getLedger = (id: string, q: { from?: string; to?: string } = {}) => apiFetch<AccountLedger>(`${BASE}/accounts/${id}/ledger${range(q)}`);
export const listJournals = (q: { status?: string; kind?: string; from?: string; to?: string; accountId?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; journals: JournalEntry[] }>(`${BASE}/journals${range(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v === undefined ? undefined : String(v)])))}`);
export const createJournal = (body: { entryDate: string; description: string; reference?: string | null; lines: Array<{ accountId: string; debit: number; credit: number; memo?: string | null }> }, idempotencyKey: string) =>
  apiFetch<{ journal: JournalEntry; replayed: boolean }>(`${BASE}/journals`, { method: "POST", body, idempotencyKey });
export const postJournal = (id: string) => apiFetch<{ journal: JournalEntry }>(`${BASE}/journals/${id}/post`, { method: "POST", body: {} });
export const deleteJournal = (id: string) => apiFetch<void>(`${BASE}/journals/${id}`, { method: "DELETE" });
export const reverseJournal = (id: string, reason: string) => apiFetch<unknown>(`${BASE}/journals/${id}/reverse`, { method: "POST", body: { reason } });
export const getTrialBalance = (q: { from?: string; to?: string } = {}) => apiFetch<TrialBalance>(`${BASE}/trial-balance${range(q)}`);
export const getIncomeStatement = (q: { from?: string; to?: string } = {}) => apiFetch<IncomeStatement>(`${BASE}/statements/income${range(q)}`);
export const getBalanceSheet = (q: { asOf?: string } = {}) => apiFetch<BalanceSheet>(`${BASE}/statements/balance-sheet${range(q)}`);
export const getCashFlow = (q: { from?: string; to?: string } = {}) => apiFetch<CashFlow>(`${BASE}/statements/cash-flow${range(q)}`);

// ── ERP E7: expenses and recurring commitments (docs/FINANCE_EXPENSES.md) ────────────────────────────────────────────────
export type CostBehaviour = "FIXED" | "VARIABLE";
export type CommitmentFrequency = "MONTHLY" | "QUARTERLY" | "YEARLY";
export interface Expense {
  id: string; number: string; expenseDate: string; expenseAccount: { id: string; code: string; name: string }; amount: number; costBehaviour: CostBehaviour;
  payee: string | null; description: string; reference: string | null; evidence: string | null; commitment: { id: string; name: string } | null; periodKey: string | null;
  status: MovementStatus; paidFrom: { id: string; name: string } | null; movementId: string; note: string | null; createdAt: string;
}
export interface CommitmentPeriod { periodKey: string; dueDate: string; status: "PAID" | "AWAITING_APPROVAL" | "OVERDUE" | "DUE"; expense: { id: string; number: string; amount: number } | null }
export interface Commitment {
  id: string; name: string; expenseAccount: { id: string; code: string; name: string }; amount: number; monthlyAmount: number; frequency: CommitmentFrequency; dayOfMonth: number;
  startDate: string; endDate: string | null; costBehaviour: CostBehaviour; payee: string | null; financialAccount: { id: string; name: string } | null; isActive: boolean; notes: string | null;
  schedule: CommitmentPeriod[]; nextDue: CommitmentPeriod | null;
}
export interface CommitmentsOverview {
  asOf: string; commitments: Commitment[]; totals: { fixedMonthly: number; variableMonthly: number };
  overdue: Array<CommitmentPeriod & { commitmentId: string; name: string; amount: number }>; dueSoon: Array<CommitmentPeriod & { commitmentId: string; name: string; amount: number }>;
}
export interface ExpenseSummary {
  period: { from: string; to: string }; accounts: Array<{ account: { id: string; code: string; name: string }; fixed: number; variable: number; total: number }>;
  totals: { fixed: number; variable: number; total: number }; fixedMonthlyCommitments: number; grossMarginPct: number | null; breakEvenMonthlyRevenue: number | null;
}
export const expenseKeys = {
  all: ["finance", "expenses"] as const,
  list: (q: object) => ["finance", "expenses", "list", q] as const,
  summary: (q: object) => ["finance", "expenses", "summary", q] as const,
  commitments: () => ["finance", "expenses", "commitments"] as const,
};
export const listExpenses = (q: { from?: string; to?: string; pageSize?: number } = {}) => apiFetch<{ total: number; expenses: Expense[] }>(`${BASE}/expenses${range(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v === undefined ? undefined : String(v)])))}`);
export const getExpenseSummary = (q: { from?: string; to?: string } = {}) => apiFetch<ExpenseSummary>(`${BASE}/expenses/summary${range(q)}`);
export const recordExpense = (body: Record<string, unknown>, idempotencyKey: string) => apiFetch<{ expense: Expense; replayed: boolean }>(`${BASE}/expenses`, { method: "POST", body, idempotencyKey });
export const listCommitments = () => apiFetch<CommitmentsOverview>(`${BASE}/commitments`);
export const createCommitment = (body: Record<string, unknown>) => apiFetch<Commitment>(`${BASE}/commitments`, { method: "POST", body });
export const updateCommitment = (id: string, body: Record<string, unknown>) => apiFetch<Commitment>(`${BASE}/commitments/${id}`, { method: "PATCH", body });

// ── ERP E9: fixed assets and depreciation (docs/FINANCE_FIXED_ASSETS.md) ─────────────────────────────────────────────────
export type DepreciationMethod = "STRAIGHT_LINE" | "DECLINING_BALANCE";
export interface FixedAsset {
  id: string; number: string; name: string; category: string | null; assetAccount: { id: string; code: string; name: string }; acquisitionDate: string;
  cost: number; residualValue: number; usefulLifeMonths: number; method: DepreciationMethod; decliningRatePct: number | null; depreciationStart: string;
  openingAccumulatedDepreciation: number; accumulatedDepreciation: number; bookValue: number; lastDepreciatedMonth: string | null;
  nextCharge: { periodKey: string; amount: number } | null; monthsLeft: number; fullyDepreciatedBy: string | null;
  location: string | null; custodian: string | null; serialNumber: string | null; notes: string | null; sourceType: string; sourceRef: string | null;
  status: "IN_USE" | "DISPOSED"; disposedAt: string | null; disposalProceeds: number | null; disposalGainLoss: number | null; disposalReason: string | null;
}
export interface DepreciationRun { id: string; periodKey: string; status: "POSTED" | "REVERSED"; total: number; assets: number; createdAt: string; reversedAt: string | null; reversalReason: string | null }
export interface AssetRegister { asOf: string; assets: FixedAsset[]; totals: { cost: number; accumulatedDepreciation: number; bookValue: number; assets: number }; nextRun: string | null; nextRunCharge: number; runs: DepreciationRun[] }
export const assetKeys = { register: (q: object) => ["finance", "fixed-assets", q] as const };
export const getAssetRegister = (includeDisposed = false) => apiFetch<AssetRegister>(`${BASE}/fixed-assets${includeDisposed ? "?includeDisposed=true" : ""}`);
export const createAsset = (body: Record<string, unknown>) => apiFetch<FixedAsset>(`${BASE}/fixed-assets`, { method: "POST", body });
export const disposeAsset = (id: string, body: Record<string, unknown>) => apiFetch<FixedAsset>(`${BASE}/fixed-assets/${id}/dispose`, { method: "POST", body });
export const runDepreciation = (periodKey: string) => apiFetch<{ run: DepreciationRun; replayed: boolean }>(`${BASE}/depreciation-runs`, { method: "POST", body: { periodKey } });
export const reverseLatestDepreciation = (reason: string) => apiFetch<DepreciationRun>(`${BASE}/depreciation-runs/reverse-latest`, { method: "POST", body: { reason } });

// ── ERP E10: loans (docs/FINANCE_LOANS.md) ────────────────────────────────────────────────────────────────────────────
export type LoanRepaymentType = "ANNUITY" | "EQUAL_PRINCIPAL";
export interface Loan {
  id: string; number: string; lender: string; reference: string | null; principal: number; annualRatePct: number; termMonths: number; repaymentType: LoanRepaymentType;
  drawdownDate: string; firstDueDate: string; financialAccount: { id: string; name: string }; status: "AWAITING_APPROVAL" | "ACTIVE" | "REPAID" | "CANCELLED"; notes: string | null;
  drawn: number; principalRepaid: number; outstanding: number; interestAccrued: number; interestPaid: number; interestDue: number; lastAccruedMonth: string | null;
  nextInstalment: { dueDate: string; payment: number } | null;
  schedule: Array<{ n: number; dueDate: string; payment: number; interest: number; principal: number; balance: number }>;
  repayments: Array<{ id: string; paymentDate: string; interestPart: number; principalPart: number; reference: string | null; status: string }>;
}
export interface LoansOverview { asOf: string; loans: Loan[]; totals: { outstanding: number; interestDue: number; active: number }; nextAccrual: string | null; runs: Array<{ id: string; periodKey: string; status: "POSTED" | "REVERSED"; total: number; loans: number; reversalReason: string | null }> }
export const loanKeys = { all: () => ["finance", "loans"] as const };
export const listLoans = () => apiFetch<LoansOverview>(`${BASE}/loans`);
export const drawLoan = (body: Record<string, unknown>, idempotencyKey: string) => apiFetch<{ loan: Loan; replayed: boolean }>(`${BASE}/loans`, { method: "POST", body, idempotencyKey });
export const repayLoan = (id: string, body: Record<string, unknown>, idempotencyKey: string) => apiFetch<{ loan: Loan; replayed: boolean }>(`${BASE}/loans/${id}/repayments`, { method: "POST", body, idempotencyKey });
export const runLoanAccrual = (periodKey: string) => apiFetch<{ run: { periodKey: string; total: number } }>(`${BASE}/loan-accruals`, { method: "POST", body: { periodKey } });
export const reverseLoanAccrual = (reason: string) => apiFetch<{ periodKey: string }>(`${BASE}/loan-accruals/reverse-latest`, { method: "POST", body: { reason } });

// ── ERP E12: budgets, cash forecast & runway (docs/FINANCE_BUDGETS.md) ───────────────────────────────────────────────────
export interface BudgetSummary { id: string; name: string; startMonth: string; months: number; endMonth: string; notes: string | null; lines: number; updatedAt: string }
export interface BudgetRow {
  account: { id: string; code: string; name: string; type: LedgerAccountType };
  months: Array<{ periodKey: string; budget: number; actual: number }>;
  budgetYear: number; budgetYtd: number; actualYtd: number; variance: number; variancePct: number | null; favourable: boolean | null;
}
export interface BudgetVsActual { budget: { id: string; name: string; startMonth: string; months: number; notes: string | null }; months: string[]; through: string; rows: BudgetRow[]; totals: { netProfit: { budgetYear: number; budgetYtd: number; actualYtd: number; variance: number } } }
export interface CashForecast {
  asOf: string; weeks: number; opening: number; money: Array<{ name: string; kind: string; balance: number }>;
  lines: Array<{ date: string; week: number; source: "CLEARING" | "SUPPLIER_BILL" | "COMMITMENT" | "LOAN" | "PURCHASE_ORDER"; label: string; amount: number; ref: string | null }>;
  byWeek: Array<{ week: number; from: string; to: string; inflow: number; outflow: number; closing: number }>;
  closing: number; lowest: { balance: number; week: number; date: string };
  runway: { averageMonthlyChange: number; months: number | null; basis: string };
}
export const budgetKeys = { list: () => ["finance", "budgets"] as const, one: (id: string) => ["finance", "budgets", id] as const, forecast: (weeks: number) => ["finance", "cash-forecast", weeks] as const };
export const listBudgets = () => apiFetch<{ budgets: BudgetSummary[] }>(`${BASE}/budgets`);
export const getBudget = (id: string) => apiFetch<BudgetVsActual>(`${BASE}/budgets/${id}`);
export const createBudget = (body: Record<string, unknown>) => apiFetch<{ id: string; name: string; lines: number }>(`${BASE}/budgets`, { method: "POST", body });
export const setBudgetLines = (id: string, lines: Array<{ accountId: string; periodKey: string; amount: number }>) => apiFetch<{ id: string }>(`${BASE}/budgets/${id}/lines`, { method: "PUT", body: { lines } });
export const getCashForecast = (weeks = 13) => apiFetch<CashForecast>(`${BASE}/cash-forecast?weeks=${weeks}`);
