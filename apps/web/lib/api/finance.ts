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

export type MovementKind = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER" | "ADJUSTMENT" | "OPENING_FUNDING";
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
export const MOVEMENT_PATH: Record<Exclude<MovementKind, "OPENING_FUNDING">, string> = { DEPOSIT: "deposit", WITHDRAWAL: "withdrawal", TRANSFER: "transfer", ADJUSTMENT: "adjustment" };
export const requestMovement = (kind: Exclude<MovementKind, "OPENING_FUNDING">, body: Record<string, unknown>, idempotencyKey: string) =>
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
