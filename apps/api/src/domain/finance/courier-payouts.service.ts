/**
 * Courier payouts and the courier's side of the books (docs/FINANCE_OWNER_BOOKS.md §3.2, §3.5, §3.6).
 *
 * Import: Steadfast's payouts are pulled from its API; each payout not yet recorded becomes ONE DRAFT settlement out of
 * COD clearing (reference "steadfast:<payout id>", so a second import records nothing new), one line per parcel matched to
 * its order by consignment id. The owner checks that the net reached the bank / bKash and posts it — posting books the
 * ACTUAL charges and withdraws the order's estimates. The response shape was checked against the live API (below);
 * anything unreadable is reported, never guessed, and the statement-file import remains.
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
import { loadRateCards } from "./charge-projection";
import { courierChargeEstimate, courierOutcome } from "./charge-estimates";

// ── parsing Steadfast's payout responses ──────────────────────────────────────────────────────────────────────────────
//
// Verified against the live API (2026-10-21):
//   GET /payments        { status, message, payments: [{ payment_id, amount, charges, due_bills, total, method, status_label,
//                          created_at, paid_at, … }] }
//   GET /payments/:id    { status, message, payment: { …same, consignments: [{ consignment_id, invoice, cod_amount, status, … }] } }
// and on every payout so far:  amount (cash collected) − due_bills (delivery & return charges) − charges (COD charge)
//                               = total (what reached the account).
// A parcel's cod_amount is what it was BOOKED for, not what was collected, and no charge is given per parcel — so the
// lines are built from the payout's own totals (buildPayoutLines). Other shapes are still read defensively.

export interface ParsedPayout {
  id: string;
  /** What reached the account (major units). */
  net: number;
  /** Cash collected, delivery & return charges, COD charge — null when the response doesn't give them. */
  gross: number | null;
  deliveryCharges: number | null;
  codCharges: number | null;
  date: string | null;
}
export interface ParsedPayoutLine {
  consignmentId: string | null;
  invoice: string | null;
  /** The COD the parcel was booked for (major units). */
  booked: number;
  /** Steadfast's parcel status (delivered, partial_delivered, cancelled, …). */
  status: string | null;
  /** Older / other shapes only: a per-parcel charge when the response gives one. */
  charge: number | null;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/,/g, "")))) return Number(v.replace(/,/g, ""));
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
/** A parcel booked straight on the courier's panel has no invoice — and Steadfast sends that as the text "null" too. */
export const invoiceOf = (v: unknown): string | null => {
  const s = str(v);
  return s && !["null", "undefined", "n/a", "-"].includes(s.toLowerCase()) ? s : null;
};
const first = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null);
const listOf = (data: unknown): unknown[] | null => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["payments", "data", "items", "results", "consignments"]) {
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

function payoutOf(o: Record<string, unknown>): ParsedPayout | null {
  const id = str(first(o, ["payment_id", "id", "payout_id"]));
  const gross = num(first(o, ["amount", "total_amount"]));
  const deliveryCharges = num(o.due_bills);
  const codCharges = num(o.charges);
  // "total" is the net paid; without it, an old shape's single amount is taken as the net.
  const net = num(first(o, ["total", "net_amount", "paid_amount"])) ?? (deliveryCharges === null && codCharges === null ? gross : null);
  if (!id || net === null) return null;
  const full = gross !== null && deliveryCharges !== null && codCharges !== null;
  return { id, net, gross: full ? gross : null, deliveryCharges: full ? deliveryCharges : null, codCharges: full ? codCharges : null, date: dateOf(first(o, ["paid_at", "created_at", "date", "updated_at"])) };
}

/** Steadfast's payout list; rows it can't read are skipped (counted). */
export function parsePayoutList(data: unknown): { payouts: ParsedPayout[]; unreadable: number } {
  const rows = listOf(data);
  if (!rows) throw financeError(409, "COURIER_PAYOUTS_UNREADABLE", "Steadfast's payout list wasn't in a shape we can read — import the payout file instead");
  const payouts: ParsedPayout[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const p = payoutOf((r ?? {}) as Record<string, unknown>);
    if (p) payouts.push(p);
    else unreadable += 1;
  }
  return { payouts, unreadable };
}

/** One payout with its parcels. */
export function parsePayoutDetail(data: unknown): { payout: ParsedPayout | null; lines: ParsedPayoutLine[]; unreadable: number } {
  const root = (data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const inner = [root.payment, root.data].find((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown> | undefined;
  const body = inner ?? root;
  const rows = listOf(body.consignments ?? body.parcels ?? body.items ?? root.consignments ?? data);
  if (!rows) throw financeError(409, "COURIER_PAYOUT_UNREADABLE", "Steadfast's payout detail wasn't in a shape we can read — import the payout file instead");
  const lines: ParsedPayoutLine[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const o = (r ?? {}) as Record<string, unknown>;
    const consignmentId = str(first(o, ["consignment_id", "cid", "consignmentId"]));
    const invoice = invoiceOf(first(o, ["invoice", "invoice_id", "merchant_invoice"]));
    const booked = num(first(o, ["cod_amount", "collected_amount", "collected", "amount"]));
    const total = num(first(o, ["total_charge", "total_fee", "charge"]));
    const parts = ["delivery_charge", "delivery_fee", "cod_charge", "cod_fee", "return_charge", "return_fee"].map((k) => num(o[k])).filter((x): x is number => x !== null);
    if ((!consignmentId && !invoice) || booked === null) {
      unreadable += 1;
      continue;
    }
    lines.push({ consignmentId, invoice, booked: Math.max(0, booked), status: str(o.status), charge: total ?? (parts.length ? parts.reduce((s, x) => s + x, 0) : null) });
  }
  return { payout: payoutOf(body), lines, unreadable };
}

/** Spreads `total` (minor) by weights; the last share takes the rounding, so it adds up exactly. */
function spread(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? total : 0));
  let given = 0;
  return weights.map((w, i) => {
    if (i === weights.length - 1) return total - given;
    const share = Math.round((total * w) / sum);
    given += share;
    return share;
  });
}

/**
 * A payout's settlement lines, in minor units, adding up EXACTLY to the payout's own totals (verified shape):
 *   collected — a delivered parcel its booked COD; a returned one nothing; partly delivered ones share what is left of
 *               the payout's cash collected (by their booked COD);
 *   charge    — delivery & return charges plus the COD charge, shared by `weights` (the rate card's estimate for each
 *               parcel when there is one — so each order shows a realistic cost; equal shares otherwise).
 * Pure.
 */
export function buildPayoutLines(
  payout: { gross: number; charges: number },
  parcels: Array<{ booked: number; status: string | null }>,
  weights: number[],
): Array<{ collected: number; charge: number }> {
  const kind = (s: string | null) => (s ?? "").toLowerCase();
  const delivered = parcels.map((p) => kind(p.status).startsWith("delivered"));
  const returned = parcels.map((p) => kind(p.status).startsWith("cancelled"));
  const deliveredSum = parcels.reduce((s, p, i) => s + (delivered[i] ? p.booked : 0), 0);
  let collected: number[];
  if (deliveredSum <= payout.gross) {
    const rest = spread(payout.gross - deliveredSum, parcels.map((p, i) => (!delivered[i] && !returned[i] ? Math.max(1, p.booked) : 0)));
    collected = parcels.map((p, i) => (delivered[i] ? p.booked : returned[i] ? 0 : rest[i]!));
    // Nothing partly delivered to take the rest: it stays on the last delivered parcel (a price change at the door).
    const leftover = payout.gross - collected.reduce((s, x) => s + x, 0);
    if (leftover !== 0) {
      const at = delivered.lastIndexOf(true) >= 0 ? delivered.lastIndexOf(true) : parcels.length - 1;
      collected[at] = collected[at]! + leftover;
    }
  } else {
    // Collected less than the delivered parcels were booked for: shared by booked COD.
    collected = spread(payout.gross, parcels.map((p, i) => (returned[i] ? 0 : p.booked)));
  }
  const charges = spread(payout.charges, weights.length === parcels.length ? weights : parcels.map(() => 1));
  return parcels.map((_, i) => ({ collected: collected[i]!, charge: charges[i]! }));
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
  const { cards } = await loadRateCards(business.id, cur);
  const imported: Array<ReturnType<typeof settlementDto>> = [];
  const problems: Array<{ payoutId: string; message: string }> = [];
  for (const listed of fresh) {
    try {
      const detail = parsePayoutDetail(await courier.payout(listed.id));
      if (!detail.lines.length) throw financeError(409, "COURIER_PAYOUT_EMPTY", "No parcels in this payout");
      const p = detail.payout ?? listed;
      const paid = toMinor(p.net, cur);
      let lines: SettlementLineInput[];
      if (p.gross !== null && p.deliveryCharges !== null && p.codCharges !== null) {
        const gross = toMinor(p.gross, cur);
        const charges = toMinor(p.deliveryCharges, cur) + toMinor(p.codCharges, cur);
        if (gross - charges !== paid) throw financeError(409, "COURIER_PAYOUT_TOTALS", `Steadfast's figures don't add up (${p.gross} − ${p.deliveryCharges} − ${p.codCharges} ≠ ${p.net}) — import the payout file instead`);
        const weights = await chargeWeights(detail.lines, cards, p.date ?? businessToday(business), business.timezone, cur);
        const built = buildPayoutLines({ gross, charges }, detail.lines.map((l) => ({ booked: toMinor(l.booked, cur), status: l.status })), weights);
        lines = detail.lines.map((l, i) => ({
          orderNumber: l.invoice, externalRef: l.consignmentId, amount: toMajorNumber(built[i]!.collected, cur), fee: toMajorNumber(built[i]!.charge, cur),
          note: [l.consignmentId ? `Consignment ${l.consignmentId}` : null, l.status].filter(Boolean).join(" · ") || null,
        })).filter((l) => l.amount > 0 || (l.fee ?? 0) > 0);
      } else {
        // An older / different shape with a charge per parcel.
        lines = detail.lines.map((l) => ({ orderNumber: l.invoice, externalRef: l.consignmentId, amount: l.booked, fee: l.charge ?? 0, note: l.consignmentId ? `Consignment ${l.consignmentId}` : null }));
      }
      const gross = lines.reduce((s, l) => s + toMinor(l.amount, cur), 0);
      const fee = lines.reduce((s, l) => s + toMinor(l.fee ?? 0, cur), 0);
      // What Steadfast actually paid is the net; a difference from the parcels is an adjustment (on the last parcel's line,
      // so it stays attributed), shown with its reason.
      const adj = gross - fee - paid;
      if (adj !== 0) {
        const last = lines[lines.length - 1]!;
        last.adjustment = toMajorNumber(adj, cur);
        last.note = `${last.note ?? ""} · payout differs from its parcels by ${toMajorNumber(adj, cur)}`.trim();
      }
      const date = p.date ?? listed.date ?? businessToday(business);
      const { settlement } = await financeTransaction((tx) =>
        createSettlementInTx(tx, business, {
          clearingFinancialAccountId: clearing.id, destinationFinancialAccountId: dest.id, settlementDate: date, reference: `steadfast:${listed.id}`,
          evidence: `Steadfast payout ${listed.id}: ${detail.lines.length} parcels${p.gross !== null ? `, collected ${p.gross}, delivery & return charges ${p.deliveryCharges}, COD charge ${p.codCharges}, paid ${p.net}` : ""}${detail.unreadable ? `, ${detail.unreadable} unreadable` : ""}`,
          adjustmentReason: adj !== 0 ? `Steadfast paid ${toMajorNumber(paid, cur)}; its parcels add up to ${toMajorNumber(gross - fee, cur)}` : null,
          lines, netAmount: toMajorNumber(paid, cur),
        }, actor, `steadfast-payout:${listed.id}`, "API_IMPORT", null),
      );
      imported.push(settlementDto(settlement, cur));
    } catch (err) {
      problems.push({ payoutId: listed.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  await financeTransaction((tx) => recordFinanceAudit(tx, { businessId: business.id, actor, action: "courier_payouts.import", entityType: "FinancialAccount", entityId: clearing.id, after: { imported: imported.map((s) => s.reference), problems, unreadable, destination: dest.id } }));
  return { listed: payouts.length, alreadyRecorded: payouts.length - fresh.length, imported, problems, unreadable };
}

/** Each parcel's share of the payout's charges: the rate card's estimate for it (zone, outcome, COD) — equal shares when
 * there is no card or the parcel's order isn't found. */
async function chargeWeights(parcels: ParsedPayoutLine[], cards: Awaited<ReturnType<typeof loadRateCards>>["cards"], date: string, _tz: string, cur: string): Promise<number[]> {
  if (!cards.length) return parcels.map(() => 1);
  const ids = parcels.map((p) => p.consignmentId).filter((x): x is string => Boolean(x));
  const orders = new Map((await prisma.order.findMany({ where: { courierConsignmentId: { in: ids } }, select: { courierConsignmentId: true, shippingDistrict: true, shippingArea: true } })).map((o) => [o.courierConsignmentId!, o]));
  return parcels.map((p) => {
    const o = p.consignmentId ? orders.get(p.consignmentId) : undefined;
    const outcome = courierOutcome(p.status, "");
    if (!o || !outcome) return 1;
    const e = courierChargeEstimate({ outcome, collected: outcome === "RETURNED" ? 0 : toMinor(p.booked, cur), district: o.shippingDistrict, area: o.shippingArea, date, cards });
    return e ? Math.max(1, e.total) : 1;
  });
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

