/**
 * Courier payouts and the courier's side of the books (docs/FINANCE_OWNER_BOOKS.md §3.2, §3.5, §3.6).
 *
 * Import: Steadfast's payouts are pulled from its API; each payout not yet recorded becomes ONE DRAFT settlement out of
 * COD clearing (reference "steadfast:<payout id>", so a second import records nothing new), one line per parcel matched to
 * its order by consignment id. The owner checks that the net reached the bank / bKash and posts it — posting books the
 * ACTUAL charges and withdraws the order's estimates. Steadfast's response shape is only known from a third-party SDK,
 * so it is parsed defensively and anything unreadable is reported, never guessed; the statement-file import remains.
 *
 * Reconciliation: what the books say Steadfast owes (COD clearing less the charges accrued) next to Steadfast's own
 * balance, parcels delivered but not paid out, parcels stuck on the way, and orders whose status disagrees with the courier.
 */
import { prisma } from "../../config/prisma";
import { getProviders } from "../../providers/registry";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, financeError, toMajorNumber, toMinor } from "./finance-values";
import { createSettlementInTx, settlementDto, type SettlementLineInput } from "./settlements.service";
import { moneyBalanceAt } from "./ledger.service";
import { businessDate } from "@clothing-brand/shared";

// ── parsing Steadfast's payout responses ──────────────────────────────────────────────────────────────────────────────

export interface ParsedPayout {
  id: string;
  /** Major units, as paid. */
  amount: number;
  date: string | null;
}
export interface ParsedPayoutLine {
  consignmentId: string | null;
  invoice: string | null;
  /** Cash collected for the parcel (major units). */
  collected: number;
  /** What Steadfast kept for it — delivery + COD + return charges (major units). */
  charge: number;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")))) return Number(v.replace(/,/g, ""));
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const first = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null);
const listOf = (data: unknown): unknown[] | null => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["data", "payments", "items", "results"]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
      if (o[k] && typeof o[k] === "object" && Array.isArray((o[k] as Record<string, unknown>).data)) return (o[k] as Record<string, unknown>).data as unknown[];
    }
  }
  return null;
};
const dateOf = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : null;
};

/** Steadfast's payout list → { id, amount, date }; rows it can't read are skipped (counted). */
export function parsePayoutList(data: unknown): { payouts: ParsedPayout[]; unreadable: number } {
  const rows = listOf(data);
  if (!rows) throw financeError(409, "COURIER_PAYOUTS_UNREADABLE", "Steadfast's payout list wasn't in a shape we can read — import the payout file instead");
  const payouts: ParsedPayout[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = str(first(o, ["id", "payment_id", "payout_id"]));
    const amount = num(first(o, ["amount", "total_amount", "paid_amount", "net_amount"]));
    if (!id || amount === null) {
      unreadable += 1;
      continue;
    }
    payouts.push({ id, amount, date: dateOf(first(o, ["created_at", "date", "paid_at", "updated_at"])) });
  }
  return { payouts, unreadable };
}

/** One payout's parcels. A parcel's charge is its total charge when given, else delivery + COD + return charges; when
 * only collected and net amounts are given, the charge is their difference. */
export function parsePayoutDetail(data: unknown): { lines: ParsedPayoutLine[]; unreadable: number; amount: number | null } {
  const root = (data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const body = (root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root) as Record<string, unknown>;
  const rows = listOf(body.consignments ?? body.parcels ?? body.items ?? root.consignments ?? data);
  if (!rows) throw financeError(409, "COURIER_PAYOUT_UNREADABLE", "Steadfast's payout detail wasn't in a shape we can read — import the payout file instead");
  const lines: ParsedPayoutLine[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const o = (r ?? {}) as Record<string, unknown>;
    const consignmentId = str(first(o, ["consignment_id", "cid", "consignmentId", "id"]));
    const invoice = str(first(o, ["invoice", "invoice_id", "merchant_invoice"]));
    const collected = num(first(o, ["cod_amount", "collected_amount", "collected", "amount"]));
    const total = num(first(o, ["total_charge", "total_fee", "charge"]));
    const parts = ["delivery_charge", "delivery_fee", "cod_charge", "cod_fee", "return_charge", "return_fee"].map((k) => num(o[k])).filter((x): x is number => x !== null);
    const net = num(first(o, ["payable_amount", "net_amount", "paid_amount"]));
    const charge = total ?? (parts.length ? parts.reduce((s, x) => s + x, 0) : collected !== null && net !== null ? collected - net : 0);
    if ((!consignmentId && !invoice) || collected === null) {
      unreadable += 1;
      continue;
    }
    lines.push({ consignmentId, invoice, collected: Math.max(0, collected), charge: Math.max(0, charge) });
  }
  return { lines, unreadable, amount: num(first(body, ["amount", "total_amount", "paid_amount"])) };
}

// ── import ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Pulls Steadfast's payouts and records each new one as a DRAFT settlement into `destinationFinancialAccountId`. */
export async function importCourierPayouts(input: { destinationFinancialAccountId: string; limit?: number }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const clearing = await prisma.financialAccount.findFirst({ where: { businessId: business.id, ledgerAccount: { mappings: { some: { key: "clearing.cod" } } } } });
  if (!clearing) throw financeError(409, "COD_CLEARING_MISSING", "Start the books first — COD clearing is set up then");
  const dest = await prisma.financialAccount.findFirst({ where: { id: input.destinationFinancialAccountId, businessId: business.id, isActive: true, kind: { in: ["BANK", "MOBILE_WALLET", "CASH"] } } });
  if (!dest) throw financeError(400, "PAYOUT_DESTINATION", "Choose the bank, bKash or cash account Steadfast pays into");
  const courier = getProviders().courier;
  const { payouts, unreadable } = parsePayoutList(await courier.payouts());
  const known = new Set((await prisma.clearingSettlement.findMany({ where: { clearingFinancialAccountId: clearing.id, reference: { startsWith: "steadfast:" } }, select: { reference: true } })).map((s) => s.reference));
  const fresh = payouts.filter((p) => !known.has(`steadfast:${p.id}`)).slice(0, input.limit ?? 50);
  const imported: Array<ReturnType<typeof settlementDto>> = [];
  const problems: Array<{ payoutId: string; message: string }> = [];
  for (const p of fresh) {
    try {
      const detail = parsePayoutDetail(await courier.payout(p.id));
      if (!detail.lines.length) throw financeError(409, "COURIER_PAYOUT_EMPTY", "No parcels in this payout");
      const lines: SettlementLineInput[] = detail.lines.map((l) => ({
        orderNumber: l.invoice, externalRef: l.consignmentId, amount: l.collected, fee: l.charge, note: l.consignmentId ? `Consignment ${l.consignmentId}` : null,
      }));
      const gross = lines.reduce((s, l) => s + toMinor(l.amount, cur), 0);
      const fee = lines.reduce((s, l) => s + toMinor(l.fee ?? 0, cur), 0);
      const paid = toMinor(p.amount, cur);
      // What Steadfast actually paid is the net; a difference from the parcels is an adjustment (on the last parcel's line,
      // so it stays attributed), shown with its reason.
      const adj = gross - fee - paid;
      if (adj !== 0) {
        const last = lines[lines.length - 1]!;
        last.adjustment = toMajorNumber(adj, cur);
        last.note = `${last.note ?? ""} · payout differs from its parcels by ${toMajorNumber(adj, cur)}`.trim();
      }
      const date = p.date ?? businessToday(business);
      const { settlement } = await financeTransaction((tx) =>
        createSettlementInTx(tx, business, {
          clearingFinancialAccountId: clearing.id, destinationFinancialAccountId: dest.id, settlementDate: date, reference: `steadfast:${p.id}`,
          evidence: `Steadfast payout ${p.id} (${detail.lines.length} parcels${detail.unreadable ? `, ${detail.unreadable} unreadable` : ""})`,
          adjustmentReason: adj !== 0 ? `Steadfast paid ${toMajorNumber(paid, cur)}; its parcels add up to ${toMajorNumber(gross - fee, cur)}` : null,
          lines, netAmount: toMajorNumber(paid, cur),
        }, actor, `steadfast-payout:${p.id}`, "API_IMPORT", null),
      );
      imported.push(settlementDto(settlement, cur));
    } catch (err) {
      problems.push({ payoutId: p.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  await financeTransaction((tx) => recordFinanceAudit(tx, { businessId: business.id, actor, action: "courier_payouts.import", entityType: "FinancialAccount", entityId: clearing.id, after: { imported: imported.map((s) => s.reference), problems, unreadable, destination: dest.id } }));
  return { listed: payouts.length, alreadyRecorded: payouts.length - fresh.length, imported, problems, unreadable };
}

// ── reconciliation view ───────────────────────────────────────────────────────────────────────────────────────────────

const TERMINAL = ["delivered", "partial_delivered", "cancelled"];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** The courier's side of the books on one page (§3.6). */
export async function courierReconciliation(q: { staleDays?: number; unsettledDays?: number } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const major = (v: number) => toMajorNumber(v, cur);
  const staleDays = q.staleDays ?? 10;
  const unsettledDays = q.unsettledDays ?? 7;
  const clearing = await prisma.financialAccount.findFirst({ where: { businessId: business.id, ledgerAccount: { mappings: { some: { key: "clearing.cod" } } } } });
  const clearingBalance = clearing ? await moneyBalanceAt(prisma, business.id, clearing.ledgerAccountId, cur, null) : 0;
  const accruedMapping = await prisma.accountMapping.findFirst({ where: { businessId: business.id, key: "liability.courier_charges_accrued" } });
  const accrued = accruedMapping ? -(await moneyBalanceAt(prisma, business.id, accruedMapping.accountId, cur, null)) : 0;
  let courierBalance: number | null = null;
  let courierBalanceError: string | null = null;
  try {
    courierBalance = await getProviders().courier.balance();
  } catch (err) {
    courierBalanceError = err instanceof Error ? err.message : String(err);
  }
  const openingDate = business.openingDate ? new Date(`${business.openingDate}T00:00:00Z`) : null;
  const orderSelect = { id: true, orderNumber: true, status: true, total: true, courierStatus: true, courierConsignmentId: true, courierBookedAt: true, updatedAt: true, customerName: true } as const;
  const [stale, statusMismatch, partial, deliveredCod, settledOrderIds, drafts] = await Promise.all([
    prisma.order.findMany({
      where: { deletedAt: null, courierConsignmentId: { not: null }, courierBookedAt: { lt: daysAgo(staleDays) }, OR: [{ courierStatus: null }, { courierStatus: { notIn: TERMINAL } }], status: { notIn: ["DELIVERED", "CANCELLED", "RETURNED", "PARTIALLY_DELIVERED"] } },
      select: orderSelect, orderBy: { courierBookedAt: "asc" }, take: 200,
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null, courierConsignmentId: { not: null },
        OR: [{ status: "DELIVERED", NOT: { courierStatus: { startsWith: "delivered" } } }, { courierStatus: { startsWith: "delivered" }, NOT: { status: "DELIVERED" } }],
      },
      select: orderSelect, orderBy: { updatedAt: "desc" }, take: 200,
    }),
    prisma.order.findMany({ where: { deletedAt: null, status: "PARTIALLY_DELIVERED" }, select: { ...orderSelect, paymentStatus: true, partialDeliveryReconciledAt: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.order.findMany({
      // Delivered (its COD payment recorded) since the books started and more than N days ago; earlier ones are in the
      // opening balance of COD clearing.
      where: {
        deletedAt: null, paymentMethod: "COD", status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] }, courierConsignmentId: { not: null },
        payments: { some: { provider: "COD", status: "SUCCEEDED", settledAt: { lt: daysAgo(unsettledDays), ...(openingDate ? { gte: openingDate } : {}) } } },
      },
      select: orderSelect, orderBy: { updatedAt: "asc" }, take: 500,
    }),
    prisma.clearingSettlementLine.findMany({ where: { orderId: { not: null }, settlement: { status: "POSTED", clearingAccount: { kind: "COURIER" } } }, select: { orderId: true } }),
    prisma.clearingSettlement.findMany({ where: { businessId: business.id, status: "DRAFT", clearingAccount: { kind: "COURIER" } }, select: { id: true, reference: true, settlementDate: true, netAmount: true }, orderBy: { settlementDate: "asc" } }),
  ]);
  const settled = new Set(settledOrderIds.map((l) => l.orderId));
  const row = (o: { id: string; orderNumber: string; status: string; total: unknown; courierStatus: string | null; courierConsignmentId: string | null; courierBookedAt: Date | null; updatedAt: Date; customerName: string }) => ({
    id: o.id, orderNumber: o.orderNumber, status: o.status, total: major(toMinor(o.total as never, cur)), courierStatus: o.courierStatus, consignmentId: o.courierConsignmentId,
    bookedOn: o.courierBookedAt ? businessDate(o.courierBookedAt, business.timezone) : null, updatedOn: businessDate(o.updatedAt, business.timezone), customerName: o.customerName,
  });
  const expected = clearingBalance - accrued;
  return {
    asOf: businessToday(business),
    books: { codClearing: major(clearingBalance), chargesAccrued: major(accrued), expectedFromCourier: major(expected) },
    courier: { balance: courierBalance, error: courierBalanceError, difference: courierBalance === null ? null : major(toMinor(Math.abs(courierBalance), cur) * Math.sign(courierBalance) - expected) },
    draftPayouts: drafts.map((d) => ({ id: d.id, reference: d.reference, date: businessDateOf(d.settlementDate), net: major(toMinor(d.netAmount, cur)) })),
    unsettled: deliveredCod.filter((o) => !settled.has(o.id)).map(row),
    stale: stale.map(row),
    statusMismatch: statusMismatch.map(row),
    partialDeliveries: partial.map((o) => ({ ...row(o), paymentStatus: o.paymentStatus, reconciled: Boolean(o.partialDeliveryReconciledAt), settled: settled.has(o.id) })),
    // Where Steadfast paid last time — the import's default destination.
    settings: { staleDays, unsettledDays, payoutAccountId: (await prisma.clearingSettlement.findFirst({ where: { businessId: business.id, reference: { startsWith: "steadfast:" } }, orderBy: { createdAt: "desc" }, select: { destinationFinancialAccountId: true } }))?.destinationFinancialAccountId ?? null },
  };
}

