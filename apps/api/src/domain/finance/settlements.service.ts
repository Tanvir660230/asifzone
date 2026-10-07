/**
 * Clearing settlements (Financial Core Phase 3, docs/FINANCE_PHASE_3.md §5). Money customers paid sits in a clearing
 * account (COD the courier collected, gateway payments, manual receipts) until the courier / gateway / person pays it
 * into a bank or cash account. A settlement records that payout from the statement: what left clearing (gross), what
 * arrived (net), and the ACTUAL fee and adjustment the statement shows — a fee is never assumed. Its lines say which
 * orders it covers (matched by order number, or by the gateway transaction id) so clearing reconciles order by order.
 *
 *   Dr destination (net) · Dr courier / gateway fee (fee) · Dr|Cr settlement adjustments (adjustment) · Cr clearing (gross)
 *
 * DRAFT → POSTED (one TREASURY journal through journal.service, finance.post) → REVERSED (mirror journal). Never edited
 * once posted (database trigger). Created idempotently per Idempotency-Key, and unique per clearing account + reference.
 */
import { createHash } from "node:crypto";
import type { ClearingSettlement, ClearingSettlementLine, FinancialAccount, Prisma } from "@prisma/client";
import { CLEARING_ACCOUNTS, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { parseCsv, unguardCell } from "../../lib/csv";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { postJournalInTx, reverseJournalInTx, type JournalLineSpec } from "./journal.service";
import { resolveMappedAccount } from "./chart.service";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { parseStatementAmount } from "./statement-parser";
import { upsertException } from "./finance-exceptions.service";

const adminId = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
const FEE_ACCOUNT: Record<string, AccountMappingKey> = { COURIER: "expense.courier_fees", PAYMENT_GATEWAY: "expense.gateway_fees", OTHER: "expense.settlement_adjustments" };

export interface SettlementLineInput {
  orderNumber?: string | null;
  externalRef?: string | null;
  /** Major units. */
  amount: number;
  fee?: number;
  adjustment?: number;
  note?: string | null;
}

export interface SettlementInput {
  clearingFinancialAccountId: string;
  destinationFinancialAccountId: string;
  settlementDate: string;
  reference: string;
  evidence?: string | null;
  /** Without lines: the totals. With lines they are computed from the lines (and must agree when also given). */
  grossAmount?: number | null;
  netAmount?: number | null;
  feeAmount?: number | null;
  adjustmentAmount?: number | null;
  adjustmentReason?: string | null;
  lines?: SettlementLineInput[];
}

const INCLUDE = {
  lines: { orderBy: { lineNo: "asc" } },
  clearingAccount: { select: { id: true, name: true, kind: true } },
  destinationAccount: { select: { id: true, name: true, kind: true } },
} satisfies Prisma.ClearingSettlementInclude;
type Row = Prisma.ClearingSettlementGetPayload<{ include: typeof INCLUDE }>;

export function settlementDto(s: Row, cur: string) {
  const m = (v: Prisma.Decimal) => toMajorNumber(signed(v, cur), cur);
  return {
    id: s.id, status: s.status, source: s.source, reference: s.reference, evidence: s.evidence,
    settlementDate: businessDateOf(s.settlementDate),
    clearingAccount: s.clearingAccount, destinationAccount: s.destinationAccount,
    grossAmount: m(s.grossAmount), netAmount: m(s.netAmount), feeAmount: m(s.feeAmount), adjustmentAmount: m(s.adjustmentAmount), adjustmentReason: s.adjustmentReason,
    journalEntryId: s.journalEntryId, reversalJournalEntryId: s.reversalJournalEntryId,
    postedAt: s.postedAt, reversedAt: s.reversedAt, reversalReason: s.reversalReason, createdAt: s.createdAt,
    lines: s.lines.map((l: ClearingSettlementLine) => ({ id: l.id, lineNo: l.lineNo, orderId: l.orderId, orderNumber: l.orderNumber, externalRef: l.externalRef, amount: m(l.amount), fee: m(l.fee), adjustment: m(l.adjustment), matchStatus: l.matchStatus, note: l.note })),
    unmatchedLines: s.lines.filter((l) => l.matchStatus === "UNMATCHED").length,
  };
}

function signed(v: Prisma.Decimal | number | string, cur: string): number {
  const s = v.toString();
  return s.startsWith("-") ? -toMinor(s.slice(1), cur) : toMinor(s, cur);
}
const toMinorSigned = (major: number, cur: string) => Math.sign(major) * toMinor(Math.abs(major), cur);

/** The clearing account must be one the commerce accounting maps (COD, a gateway, manual receipts). */
async function clearingKindOf(tx: AppTransactionClient, businessId: string, fa: FinancialAccount): Promise<string> {
  const mapping = await tx.accountMapping.findFirst({ where: { businessId, accountId: fa.ledgerAccountId, key: { in: CLEARING_ACCOUNTS.map((c) => c.key) } } });
  if (!mapping) throw financeError(400, "NOT_A_CLEARING_ACCOUNT", `${fa.name} is not a clearing account (COD, gateway or manual receipts)`);
  return fa.kind;
}

/** Order lookup for a statement line: by order number, else by the gateway's transaction id on a payment. */
async function matchOrder(tx: AppTransactionClient, line: SettlementLineInput): Promise<{ orderId: string | null; orderNumber: string | null }> {
  if (line.orderNumber) {
    const o = await tx.order.findUnique({ where: { orderNumber: line.orderNumber.trim() }, select: { id: true, orderNumber: true } });
    if (o) return { orderId: o.id, orderNumber: o.orderNumber };
  }
  if (line.externalRef) {
    const p = await tx.payment.findFirst({ where: { providerTransactionId: line.externalRef.trim(), orderId: { not: null } }, select: { order: { select: { id: true, orderNumber: true } } } });
    if (p?.order) return { orderId: p.order.id, orderNumber: p.order.orderNumber };
  }
  return { orderId: null, orderNumber: line.orderNumber?.trim() || null };
}

async function createInTx(tx: AppTransactionClient, business: FinanceBusinessInfo, input: SettlementInput, actor: FinanceActor, key: string, source: "MANUAL" | "CSV_IMPORT", fileHash: string | null) {
  const cur = business.baseCurrency;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-settlement:${business.id}:${key}`}))`;
  const existing = await tx.clearingSettlement.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: key } }, include: INCLUDE });
  if (existing) {
    // The same request again (same clearing account, same payout reference) is answered with what it made.
    if (existing.clearingFinancialAccountId !== input.clearingFinancialAccountId || existing.reference !== input.reference) {
      throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different settlement", { settlementId: existing.id });
    }
    return { settlement: existing, replayed: true };
  }
  const [clearing, dest] = await Promise.all([
    tx.financialAccount.findFirst({ where: { id: input.clearingFinancialAccountId, businessId: business.id } }),
    tx.financialAccount.findFirst({ where: { id: input.destinationFinancialAccountId, businessId: business.id } }),
  ]);
  if (!clearing || !dest) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Choose a clearing account and the account the money arrived in");
  if (clearing.id === dest.id) throw financeError(400, "SETTLEMENT_SAME_ACCOUNT", "A settlement moves money out of clearing into another account");
  if (!dest.isActive) throw financeError(409, "FINANCIAL_ACCOUNT_INACTIVE", `${dest.name} is inactive`);
  await clearingKindOf(tx, business.id, clearing);
  if (await tx.accountMapping.findFirst({ where: { businessId: business.id, accountId: dest.ledgerAccountId, key: { in: CLEARING_ACCOUNTS.map((c) => c.key) } } })) {
    throw financeError(400, "DESTINATION_IS_CLEARING", "Money settles into a bank, cash or wallet account, not another clearing account");
  }
  if (await tx.clearingSettlement.findUnique({ where: { clearingFinancialAccountId_reference: { clearingFinancialAccountId: clearing.id, reference: input.reference } } })) {
    throw financeError(409, "SETTLEMENT_REFERENCE_EXISTS", `A settlement with reference ${input.reference} is already recorded for ${clearing.name}`);
  }

  let gross: number, fee: number, adj: number;
  const lines = input.lines ?? [];
  const resolved = [];
  for (const [i, l] of lines.entries()) {
    if (!(l.amount > 0)) throw financeError(400, "SETTLEMENT_LINE_AMOUNT", `Line ${i + 1}: the amount must be more than zero`);
    resolved.push({ ...l, ...(await matchOrder(tx, l)), amountMinor: toMinor(l.amount, cur), feeMinor: toMinor(l.fee ?? 0, cur), adjMinor: toMinorSigned(l.adjustment ?? 0, cur) });
  }
  if (resolved.length) {
    gross = resolved.reduce((s, l) => s + l.amountMinor, 0);
    fee = resolved.reduce((s, l) => s + l.feeMinor, 0);
    adj = resolved.reduce((s, l) => s + l.adjMinor, 0);
    if (input.grossAmount != null && toMinor(input.grossAmount, cur) !== gross) throw financeError(400, "SETTLEMENT_TOTALS", "The lines don't add up to the gross amount given");
  } else {
    if (input.grossAmount == null) throw financeError(400, "SETTLEMENT_TOTALS", "Enter the gross amount, or the settlement's lines");
    gross = toMinor(input.grossAmount, cur);
    fee = toMinor(input.feeAmount ?? 0, cur);
    adj = toMinorSigned(input.adjustmentAmount ?? 0, cur);
  }
  const net = gross - fee - adj;
  if (input.netAmount != null && toMinor(input.netAmount, cur) !== net) {
    throw financeError(400, "SETTLEMENT_TOTALS", `Gross ${toMajorNumber(gross, cur)} − fee ${toMajorNumber(fee, cur)} − adjustment ${toMajorNumber(adj, cur)} is ${toMajorNumber(net, cur)}, not the net amount given`);
  }
  if (net < 0) throw financeError(400, "SETTLEMENT_TOTALS", "The fee and adjustment exceed what was cleared");
  if (adj !== 0 && !input.adjustmentReason) throw financeError(400, "ADJUSTMENT_REASON_REQUIRED", "Say what the adjustment is (from the statement)");

  const settlement = await tx.clearingSettlement.create({
    data: {
      businessId: business.id, brandId: clearing.brandId, clearingFinancialAccountId: clearing.id, destinationFinancialAccountId: dest.id,
      settlementDate: dateColumn(input.settlementDate), reference: input.reference,
      grossAmount: toDecimal(gross, cur), netAmount: toDecimal(net, cur), feeAmount: toDecimal(fee, cur), adjustmentAmount: toDecimal(adj, cur), adjustmentReason: input.adjustmentReason ?? null,
      evidence: input.evidence ?? null, source, fileHash, idempotencyKey: key, createdByAdminId: adminId(actor),
      lines: {
        create: resolved.map((l, i) => ({
          lineNo: i + 1, orderId: l.orderId, orderNumber: l.orderNumber, externalRef: l.externalRef ?? null,
          amount: toDecimal(l.amountMinor, cur), fee: toDecimal(l.feeMinor, cur), adjustment: toDecimal(l.adjMinor, cur),
          matchStatus: l.orderId ? "MATCHED" : "UNMATCHED", note: l.note ?? null,
        })),
      },
    },
    include: INCLUDE,
  });
  const audits: FinanceAuditInput[] = [
    { businessId: business.id, actor, action: "settlement.create", entityType: "ClearingSettlement", entityId: settlement.id, after: settlementDto(settlement, cur), sourceType: source, sourceRef: key },
    ...settlement.lines.map((l) => ({ businessId: business.id, actor, action: "settlement_line.create", entityType: "ClearingSettlementLine", entityId: l.id, after: l })),
  ];
  await recordFinanceAudit(tx, audits);
  for (const l of settlement.lines.filter((x) => x.matchStatus === "UNMATCHED")) {
    await upsertException(tx, business, settlement.brandId, {
      kind: "UNMATCHED_SETTLEMENT_LINE", key: `settlement-line:${l.id}`, sourceType: "ClearingSettlementLine", sourceId: l.id, orderNumber: l.orderNumber,
      title: `Settlement ${settlement.reference}: line ${l.lineNo} names no known order (${l.orderNumber ?? l.externalRef ?? "no reference"})`,
      details: { settlementId: settlement.id, lineNo: l.lineNo, orderNumber: l.orderNumber, externalRef: l.externalRef, amount: l.amount.toString() },
      amountMinor: toMinor(l.amount, cur),
    }, actor);
  }
  return { settlement, replayed: false };
}

export async function createSettlement(input: SettlementInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every settlement");
  const { business } = await getFinanceContext();
  const { settlement, replayed } = await financeTransaction((tx) => createInTx(tx, business, input, actor, `request:${idempotencyKey}`, "MANUAL", null));
  return { settlement: settlementDto(settlement, business.baseCurrency), replayed };
}

export interface SettlementCsvInput {
  clearingFinancialAccountId: string;
  destinationFinancialAccountId: string;
  settlementDate: string;
  reference: string;
  evidence?: string | null;
  adjustmentReason?: string | null;
  csv: string;
  mapping: { orderNumber?: string; externalRef?: string; amount: string; fee?: string; adjustment?: string };
  hasHeader: boolean;
  skipRows: number;
}

/** A courier / gateway settlement statement (CSV, any layout via the column mapping) becomes a DRAFT settlement with one
 * line per row. The same file again returns the same settlement; nothing posts until someone posts it. */
export async function importSettlementCsv(input: SettlementCsvInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const fileHash = createHash("sha256").update(input.csv).digest("hex");
  const records = parseCsv(input.csv).slice(input.skipRows);
  const header = input.hasHeader ? records.shift()?.cells.map((h) => unguardCell(h).trim().toLowerCase()) ?? [] : null;
  const col = (name?: string) => {
    if (!name) return -1;
    if (header) return header.indexOf(name.trim().toLowerCase());
    const n = Number(name);
    return Number.isInteger(n) && n >= 1 ? n - 1 : -1;
  };
  const idx = { orderNumber: col(input.mapping.orderNumber), externalRef: col(input.mapping.externalRef), amount: col(input.mapping.amount), fee: col(input.mapping.fee), adjustment: col(input.mapping.adjustment) };
  if (idx.amount < 0) throw financeError(400, "SETTLEMENT_MAPPING", `Column "${input.mapping.amount}" (amount) isn't in the file`);
  if (idx.orderNumber < 0 && idx.externalRef < 0) throw financeError(400, "SETTLEMENT_MAPPING", "Map the order number or the transaction id column");
  const errors: Array<{ line: number; message: string }> = [];
  const lines: SettlementLineInput[] = [];
  const cell = (cells: string[], i: number) => (i < 0 ? "" : unguardCell(cells[i] ?? "").trim());
  for (const r of records) {
    try {
      const amount = parseStatementAmount(cell(r.cells, idx.amount));
      if (amount === null) continue; // spacer / total row without an amount
      const fee = parseStatementAmount(cell(r.cells, idx.fee));
      const adj = parseStatementAmount(cell(r.cells, idx.adjustment));
      lines.push({ orderNumber: cell(r.cells, idx.orderNumber) || null, externalRef: cell(r.cells, idx.externalRef) || null, amount: Math.abs(Number(amount)), fee: fee === null ? 0 : Math.abs(Number(fee)), adjustment: adj === null ? 0 : Number(adj) });
    } catch (err) {
      errors.push({ line: r.line, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (errors.length) throw financeError(400, "SETTLEMENT_CSV_INVALID", `${errors.length} row(s) can't be read — fix the file or the mapping`, { errors: errors.slice(0, 50) });
  if (!lines.length) throw financeError(400, "SETTLEMENT_CSV_EMPTY", "The file has no settlement rows");
  const { settlement, replayed } = await financeTransaction((tx) =>
    createInTx(tx, business, { ...input, lines }, actor, `import:${input.clearingFinancialAccountId}:${fileHash}`, "CSV_IMPORT", fileHash),
  );
  return { settlement: settlementDto(settlement, business.baseCurrency), replayed };
}

async function lockSettlement(tx: AppTransactionClient, businessId: string, id: string): Promise<Row> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ClearingSettlement" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "SETTLEMENT_NOT_FOUND", "Settlement not found");
  return tx.clearingSettlement.findUniqueOrThrow({ where: { id }, include: INCLUDE });
}

/** Posts a DRAFT settlement: one journal through journal.service; clearing is credited per order line, so the clearing
 * account reconciles order by order. Idempotent: a posted settlement is returned as it is. */
export async function postSettlement(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const s = await lockSettlement(tx, business.id, id);
    if (s.status === "POSTED") return { settlement: settlementDto(s, cur), alreadyPosted: true };
    if (s.status !== "DRAFT") throw financeError(409, "SETTLEMENT_NOT_DRAFT", "A reversed settlement can't be posted again");
    const [clearing, dest] = await Promise.all([
      tx.financialAccount.findUniqueOrThrow({ where: { id: s.clearingFinancialAccountId } }),
      tx.financialAccount.findUniqueOrThrow({ where: { id: s.destinationFinancialAccountId } }),
    ]);
    const kind = await clearingKindOf(tx, business.id, clearing);
    const fee = signed(s.feeAmount, cur), adj = signed(s.adjustmentAmount, cur), net = signed(s.netAmount, cur), gross = signed(s.grossAmount, cur);
    const lines: JournalLineSpec[] = [];
    if (net > 0) lines.push({ accountId: dest.ledgerAccountId, debit: net, credit: 0, memo: s.reference });
    if (fee > 0) lines.push({ accountId: (await resolveMappedAccount(tx, business.id, FEE_ACCOUNT[kind] ?? "expense.settlement_adjustments")).id, debit: fee, credit: 0, memo: `Fee per statement ${s.reference}` });
    if (adj !== 0) {
      const adjAccount = (await resolveMappedAccount(tx, business.id, "expense.settlement_adjustments")).id;
      lines.push(adj > 0 ? { accountId: adjAccount, debit: adj, credit: 0, memo: s.adjustmentReason } : { accountId: adjAccount, debit: 0, credit: -adj, memo: s.adjustmentReason });
    }
    if (s.lines.length) {
      for (const l of s.lines) lines.push({ accountId: clearing.ledgerAccountId, debit: 0, credit: signed(l.amount, cur), memo: l.externalRef ?? l.orderNumber, ...(l.orderId ? { partyType: "Order", partyId: l.orderId } : {}) });
    } else lines.push({ accountId: clearing.ledgerAccountId, debit: 0, credit: gross, memo: s.reference });
    const { entry } = await postJournalInTx(tx, business, {
      entryDate: businessDateOf(s.settlementDate),
      description: `Settlement ${s.reference}: ${clearing.name} → ${dest.name}`.slice(0, 300),
      reference: s.reference,
      brandId: s.brandId,
      kind: "TREASURY",
      lines,
      sourceType: "ClearingSettlement",
      sourceId: s.id,
      idempotencyKey: `settlement:${s.id}`,
    }, actor);
    const after = await tx.clearingSettlement.update({ where: { id }, data: { status: "POSTED", journalEntryId: entry.id, postedByAdminId: adminId(actor), postedAt: new Date() }, include: INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "settlement.post", entityType: "ClearingSettlement", entityId: id, before: { status: s.status }, after: { status: after.status, journalEntryId: entry.id }, sourceRef: entry.id });
    return { settlement: settlementDto(after, cur), alreadyPosted: false };
  });
}

export async function reverseSettlement(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const s = await lockSettlement(tx, business.id, id);
    if (s.status === "REVERSED") return { settlement: settlementDto(s, cur), replayed: true };
    if (s.status !== "POSTED") throw financeError(409, "SETTLEMENT_NOT_POSTED", "Only a posted settlement can be reversed — delete a draft instead");
    const matched = await tx.bankTransactionMatch.count({ where: { status: "ACTIVE", journalLine: { entryId: s.journalEntryId! } } });
    if (matched) throw financeError(409, "SETTLEMENT_MATCHED", "A bank statement line is matched to this settlement — unmatch it first");
    const today = businessToday(business);
    const date = today < businessDateOf(s.settlementDate) ? businessDateOf(s.settlementDate) : today;
    const { reversal } = await reverseJournalInTx(tx, business, s.journalEntryId!, reason, date, actor);
    const after = await tx.clearingSettlement.update({ where: { id }, data: { status: "REVERSED", reversalJournalEntryId: reversal.id, reversedByAdminId: adminId(actor), reversedAt: new Date(), reversalReason: reason }, include: INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "settlement.reverse", entityType: "ClearingSettlement", entityId: id, before: { status: s.status }, after: { status: after.status }, reason, sourceRef: reversal.id });
    return { settlement: settlementDto(after, cur), replayed: false };
  });
}

export async function deleteDraftSettlement(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const s = await lockSettlement(tx, business.id, id);
    if (s.status !== "DRAFT") throw financeError(409, "SETTLEMENT_NOT_DRAFT", "A posted settlement is history — reverse it instead");
    await recordFinanceAudit(tx, [
      { businessId: business.id, actor, action: "settlement.delete_draft", entityType: "ClearingSettlement", entityId: id, before: settlementDto(s, business.baseCurrency) },
      ...s.lines.map((l) => ({ businessId: business.id, actor, action: "settlement_line.delete", entityType: "ClearingSettlementLine", entityId: l.id, before: l })),
    ]);
    await tx.clearingSettlement.delete({ where: { id } });
  });
}

export async function getSettlement(id: string) {
  const { business } = await getFinanceContext();
  const s = await prisma.clearingSettlement.findFirst({ where: { id, businessId: business.id }, include: INCLUDE });
  if (!s) throw financeError(404, "SETTLEMENT_NOT_FOUND", "Settlement not found");
  return settlementDto(s, business.baseCurrency);
}

export async function listSettlements(q: { clearingFinancialAccountId?: string; status?: ClearingSettlement["status"]; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.ClearingSettlementWhereInput = { businessId: business.id, clearingFinancialAccountId: q.clearingFinancialAccountId, status: q.status };
  const [total, rows] = await Promise.all([
    prisma.clearingSettlement.count({ where }),
    prisma.clearingSettlement.findMany({ where, include: INCLUDE, orderBy: [{ settlementDate: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, settlements: rows.map((s) => settlementDto(s, business.baseCurrency)) };
}

/** Clearing, order by order: what came in for each order (payments) and what settlements took out; what is still open. */
/**
 * Per order, a clearing account's money in minor units: paid in, taken out by settlements, and taken out otherwise
 * (gateway refunds). A reversal counts against the entry it reverses — a reversed settlement un-settles, it is not money
 * paid in. paid − settled − other is the order's balance in clearing.
 */
export async function clearingBreakdown(businessId: string, ledgerAccountId: string, cur: string) {
  const rows = await prisma.$queryRaw<Array<{ partyId: string | null; paid: Prisma.Decimal; settled: Prisma.Decimal; other: Prisma.Decimal }>>`
    SELECT l."partyId",
      COALESCE(SUM(CASE WHEN e."reversesEntryId" IS NULL THEN l.debit ELSE -l.credit END) FILTER (WHERE COALESCE(o."sourceType", e."sourceType") IS DISTINCT FROM 'ClearingSettlement'), 0) AS paid,
      COALESCE(SUM(l.credit - l.debit) FILTER (WHERE COALESCE(o."sourceType", e."sourceType") = 'ClearingSettlement'), 0) AS settled,
      COALESCE(SUM(CASE WHEN e."reversesEntryId" IS NULL THEN l.credit ELSE -l.debit END) FILTER (WHERE COALESCE(o."sourceType", e."sourceType") IS DISTINCT FROM 'ClearingSettlement'), 0) AS other
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" LEFT JOIN "JournalEntry" o ON o.id = e."reversesEntryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND l."accountId" = ${ledgerAccountId}
    GROUP BY l."partyId"`;
  return rows.map((r) => {
    const paid = toMinor(r.paid, cur), settled = toMinor(r.settled, cur), other = toMinor(r.other, cur);
    return { orderId: r.partyId, paid, settled, other, balance: paid - settled - other };
  });
}

export async function clearingPosition(financialAccountId: string) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const fa = await prisma.financialAccount.findFirst({ where: { id: financialAccountId, businessId: business.id } });
  if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Financial account not found");
  const rows = await clearingBreakdown(business.id, fa.ledgerAccountId, cur);
  const orderIds = rows.map((r) => r.orderId).filter((x): x is string => Boolean(x));
  const orders = new Map((await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true, status: true } })).map((o) => [o.id, o]));
  const major = (v: number) => toMajorNumber(v, cur);
  const positions = rows
    // received: paid in, less what left other than by settlement (a gateway refund); settled: net of reversed settlements.
    .map((r) => ({ orderId: r.orderId, orderNumber: r.orderId ? (orders.get(r.orderId)?.orderNumber ?? null) : null, orderStatus: r.orderId ? (orders.get(r.orderId)?.status ?? null) : null, received: major(r.paid - r.other), settled: major(r.settled), open: major(r.balance) }))
    .filter((p) => p.open !== 0)
    .sort((a, b) => b.open - a.open);
  return { account: { id: fa.id, name: fa.name, kind: fa.kind }, balance: positions.reduce((s, p) => s + p.open, 0), openOrders: positions.filter((p) => p.orderId && p.open > 0), oversettled: positions.filter((p) => p.open < 0), unattributed: positions.filter((p) => !p.orderId) };
}
