/**
 * Add cost (docs/FINANCE_ADD_COST.md) — one way to record anything the business pays for. The person says what it was,
 * how much, when and whose money; this picks the record the books already have for it and makes it in ONE transaction:
 *
 *   PACKAGING / BILL / OTHER  an expense (expenses.service)
 *   YEARLY                    a prepaid cost spread over its months (prepaid.service)
 *   BRINGING                  a landed cost on a purchase (landed-costs.service); an expense on freight-in when stock
 *                             costing isn't live, as the books would have no stock value to add it to
 *   EQUIPMENT                 the payment onto a fixed-asset account and the asset in the register (fixed-assets.service)
 *   ADS                       the money paid to the ad account (Meta takes the daily spend from it, see ads.service)
 *
 * Goods for stock are not here: they are a purchase (stock/purchase.service), which the Add cost sheet opens instead.
 *
 * "Asif's own money" (paidFrom OWNER) is the owner's pocket: the money comes in as capital (or owed back to him) and pays
 * the cost the same day, as the owner's history and the purchase form already do — two records, one step.
 * Undo (`undoCost`) reverses the cost and, when the owner's money came in for it, that money too.
 */
import type { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { actorCan, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, financeError, toMajorNumber, toMinor } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { requestMovementInTx, reverseMovementInTx } from "./treasury.service";
import { recordExpenseInTx } from "./expenses.service";
import { createPrepaidInTx, syncPrepaid } from "./prepaid.service";
import { cancelLandedCost, createLandedCostInTx } from "./landed-costs.service";
import { createAssetInTx } from "./fixed-assets.service";
import { activeCostingInTx } from "./costing.service";
import { processFinancialEvent } from "./events.service";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";
import { recordOwnerAdvanceInTx, type OwnerAdvanceSource } from "./owner-advances.service";
import { ensureOwnerPocket, findOwnerPocket } from "../stock/purchase.service";

export const COST_KINDS = ["PACKAGING", "BILL", "OTHER", "YEARLY", "BRINGING", "EQUIPMENT", "ADS"] as const;
export type CostKind = (typeof COST_KINDS)[number];

export interface AddCostInput {
  kind: CostKind;
  amount: number;
  date?: string;
  /** What it was, in a line ("10 rolls of tape"). */
  note?: string | null;
  payee?: string | null;
  paidFrom: { kind: "OWNER"; funding?: "CAPITAL" | "REIMBURSE" } | { kind: "ACCOUNT"; financialAccountId: string };
  /** BILL / OTHER (and PACKAGING to override): the expense account. */
  expenseAccountId?: string | null;
  /** YEARLY: how many months it covers from `serviceStart` (default the date). */
  months?: number;
  serviceStart?: string;
  /** BRINGING: the purchases (posted goods receipts) it brought; default the latest one. */
  goodsReceiptIds?: string[];
  /** EQUIPMENT: the asset account (default equipment) and how many months it lasts. */
  assetAccountId?: string | null;
  usefulLifeMonths?: number;
  /** ADS: the ad account (default the only one). */
  adAccountId?: string | null;
}

const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
/** Expense accounts the books fill themselves, or that only an accountant uses — never offered for a typed cost. */
const TECHNICAL_KEYS = [
  "expense.salaries", "expense.employer_contributions", "expense.advertising", "expense.courier_fees", "expense.freight_in", "expense.gateway_fees",
  "expense.depreciation", "expense.settlement_adjustments", "expense.non_recoverable_tax", "expense.cash_over_short", "expense.unallocated",
  "expense.interest", "expense.asset_disposal_loss",
];
const isPackaging = (name: string) => /packag/i.test(name);
const LABEL: Record<CostKind, string> = { PACKAGING: "Packaging", BILL: "Bill", OTHER: "Cost", YEARLY: "Paid in advance", BRINGING: "Bringing goods", EQUIPMENT: "Equipment", ADS: "Ad account top-up" };

/** The idempotency keys of the movements a cost makes, from the key its request came with. */
export const costKeys = (key: string) => ({ cost: `cost:${key}`, funding: `cost:${key}:funding` });

async function expenseAccounts(businessId: string) {
  const [accounts, maps] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { businessId, type: { in: ["EXPENSE", "OTHER_EXPENSE"] }, isPostable: true, isActive: true, isSensitive: false }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.accountMapping.findMany({ where: { businessId, key: { in: [...TECHNICAL_KEYS, "expense.purchases_other", "expense.sms"] } }, select: { key: true, accountId: true } }),
  ]);
  const hidden = new Set(maps.filter((m) => TECHNICAL_KEYS.includes(m.key)).map((m) => m.accountId));
  const other = maps.find((m) => m.key === "expense.purchases_other")?.accountId ?? null;
  return { offered: accounts.filter((a) => !hidden.has(a.id)), other, packaging: accounts.find((a) => isPackaging(a.name))?.id ?? null };
}

/** What the Add cost sheet needs: whose money, the accounts to choose from, the purchases a carrying cost can go on, and
 * the last costs to repeat. */
export async function addCostOptions(actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const [pocket, paying, ads, assets, receipts, acc, recent, costing] = await Promise.all([
    findOwnerPocket(business.id),
    prisma.financialAccount.findMany({ where: { businessId: business.id, isActive: true, kind: { in: ["CASH", "BANK", "MOBILE_WALLET"] } }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.financialAccount.findMany({ where: { businessId: business.id, isActive: true, kind: "AD_PLATFORM" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.ledgerAccount.findMany({ where: { businessId: business.id, type: "ASSET", isPostable: true, isActive: true, code: { gte: "1800", lt: "1890" } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.goodsReceipt.findMany({ where: { businessId: business.id, status: "POSTED" }, orderBy: { receiptDate: "desc" }, take: 8, include: { supplier: { select: { displayName: true } }, lines: { select: { value: true } } } }),
    expenseAccounts(business.id),
    prisma.expense.findMany({ where: { businessId: business.id, movement: { status: "POSTED" } }, orderBy: { createdAt: "desc" }, take: 30, select: { description: true, payee: true, amount: true, expenseAccountId: true } }),
    activeCostingInTx(prisma as never),
  ]);
  const seen = new Set<string>();
  const again = recent
    .filter((e) => {
      const k = `${e.expenseAccountId}|${e.description.toLowerCase()}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, 4)
    .map((e) => ({ kind: (e.expenseAccountId === acc.packaging ? "PACKAGING" : e.expenseAccountId === acc.other ? "OTHER" : "BILL") as CostKind, note: e.description, payee: e.payee, amount: toMajorNumber(toMinor(e.amount, cur), cur), expenseAccountId: e.expenseAccountId }));
  return {
    currency: cur,
    today: businessToday(business),
    booksStartedOn: business.openingDate,
    owner: { name: pocket.name, canUse: actorCan(actor, "finance.sensitive") },
    accounts: paying.filter((a) => a.id !== pocket.account?.id),
    adAccounts: ads,
    assetAccounts: assets,
    expenseAccounts: acc.offered.filter((a) => a.id !== acc.packaging),
    defaults: { packagingAccountId: acc.packaging ?? acc.other, otherAccountId: acc.other },
    costingLive: Boolean(costing),
    purchases: receipts.map((r) => ({
      id: r.id, date: businessDateOf(r.receiptDate), supplier: r.supplier.displayName,
      amount: toMajorNumber(r.lines.reduce((s, l) => s + toMinor(l.value, cur), 0), cur),
    })),
    again,
  };
}

async function fundFromOwnerInTx(
  tx: AppTransactionClient,
  business: FinanceBusinessInfo,
  input: { toFinancialAccountId: string; amount: number; date: string; description: string; funding: "CAPITAL" | "REIMBURSE" },
  actor: FinanceActor,
  key: string,
) {
  await ensureOwnerBooksSetupInTx(tx, business, actor);
  const counter = await resolveMappedAccount(tx, business.id, input.funding === "REIMBURSE" ? "liability.owner_reimbursable" : "equity.owner_capital");
  const { movement } = await requestMovementInTx(tx, business, {
    kind: "DEPOSIT", movementDate: input.date, amount: input.amount, toFinancialAccountId: input.toFinancialAccountId, counterAccountId: counter.id,
    description: `${input.funding === "REIMBURSE" ? "Paid by the owner (to repay)" : "Owner's money put in"}: ${input.description}`.slice(0, 300),
  }, actor, key);
  if (movement.status !== "POSTED") throw financeError(409, "FUNDING_NEEDS_APPROVAL", "The owner's money must post before the cost can be paid from it — record this as the owner, or lower the account's approval amount");
  return movement;
}

type Made = { source: "Expense" | "PrepaidCost" | "LandedCost" | "FixedAsset" | "AdTopUp"; id: string; title: string; after?: () => Promise<unknown> };

/** Records one cost (see the top of the file). Idempotent by the request key: the same key returns the same cost. */
export async function addCost(input: AddCostInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every cost");
  if (!(input.amount > 0)) throw financeError(400, "AMOUNT", "Give the amount");
  const { business } = await getFinanceContext();
  const date = input.date ?? businessToday(business);
  if (business.openingDate && date < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  if (date > businessToday(business)) throw financeError(400, "FUTURE_DATE", "A cost is recorded on or before today");
  const owner = input.paidFrom.kind === "OWNER";
  if (owner && !actorCan(actor, "finance.sensitive")) throw financeError(403, "OWNER_MONEY_PERMISSION", "Paying from the owner's own money books his capital — only the owner can");
  if (input.kind === "BRINGING" && !actorCan(actor, "finance.post")) throw financeError(403, "COST_PERMISSION", "A carrying cost changes what stock is worth — that needs finance.post");
  const funding = input.paidFrom.kind === "OWNER" ? input.paidFrom.funding ?? "CAPITAL" : null;
  const keys = costKeys(idempotencyKey);
  // The pocket the owner's money passes through (made the first time, outside the transaction, as purchases do).
  const pocket = owner && input.kind !== "ADS" ? await ensureOwnerPocket(business.id, actor) : null;
  const note = input.note?.trim() || null;

  const made = await financeTransaction(async (tx): Promise<Made & { replayed: boolean }> => {
    const prior = await tx.treasuryMovement.findFirst({ where: { businessId: business.id, idempotencyKey: { in: [`expense:${keys.cost}`, `prepaid:${keys.cost}`, `landed:${keys.cost}`, keys.cost] } }, select: { id: true } });
    if (prior) return { ...(await madeOf(tx, prior.id)), replayed: true };

    let from: string;
    let fundingId: string | null = null;
    const fund = async (to: string, description: string) => {
      const m = await fundFromOwnerInTx(tx, business, { toFinancialAccountId: to, amount: input.amount, date, description, funding: funding! }, actor, keys.funding);
      fundingId = m.id;
    };
    if (input.paidFrom.kind === "ACCOUNT") {
      const fa = await tx.financialAccount.findFirst({ where: { id: input.paidFrom.financialAccountId, businessId: business.id } });
      if (!fa || !fa.isActive || !PAYING_KINDS.has(fa.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", "Pay from cash, a bank or a wallet");
      from = fa.id;
    } else from = pocket?.financialAccountId ?? "";

    const acc = await expenseAccounts(business.id);
    let result: Made;
    switch (input.kind) {
      case "PACKAGING":
      case "BILL":
      case "OTHER": {
        const accountId = input.expenseAccountId ?? (input.kind === "PACKAGING" ? acc.packaging ?? acc.other : input.kind === "OTHER" ? acc.other : null);
        if (!accountId) throw financeError(400, "EXPENSE_ACCOUNT", "Choose what the bill is for");
        if (!acc.offered.some((a) => a.id === accountId)) throw financeError(400, "EXPENSE_ACCOUNT", "Choose one of the offered costs");
        const description = note ?? acc.offered.find((a) => a.id === accountId)!.name;
        if (owner) await fund(from, description);
        const { expense } = await recordExpenseInTx(tx, business, { expenseDate: date, expenseAccountId: accountId, amount: input.amount, fromFinancialAccountId: from, description, payee: input.payee ?? null, costBehaviour: input.kind === "BILL" ? "FIXED" : "VARIABLE" }, actor, keys.cost);
        result = { source: "Expense", id: expense.id, title: description };
        break;
      }
      case "YEARLY": {
        const months = input.months ?? 12;
        if (!Number.isInteger(months) || months < 1 || months > 60) throw financeError(400, "MONTHS", "It covers 1 to 60 months");
        const start = input.serviceStart ?? date;
        const end = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + months, Number(start.slice(8, 10)) - 1)).toISOString().slice(0, 10);
        const accountId = input.expenseAccountId ?? acc.offered.find((a) => /internet|software|hosting/i.test(a.name))?.id ?? acc.other;
        if (!accountId || !acc.offered.some((a) => a.id === accountId)) throw financeError(400, "EXPENSE_ACCOUNT", "Choose what it is for");
        if (!note) throw financeError(400, "NOTE_REQUIRED", "Say what it is (domain, server…)");
        if (owner) await fund(from, note);
        const { row } = await createPrepaidInTx(tx, business, { name: note, expenseAccountId: accountId, amount: input.amount, serviceStart: start, serviceEnd: end, fromFinancialAccountId: from, paidOn: date, payee: input.payee ?? null }, actor, keys.cost);
        result = { source: "PrepaidCost", id: row.id, title: note, after: () => syncPrepaid(row.id) };
        break;
      }
      case "BRINGING": {
        const description = note ?? "Carrying the goods";
        if (owner) await fund(from, description);
        if (!(await activeCostingInTx(tx))) {
          // No stock values yet: the cost of bringing goods is a purchase charge.
          const freight = await resolveMappedAccount(tx, business.id, "expense.freight_in");
          const { expense } = await recordExpenseInTx(tx, business, { expenseDate: date, expenseAccountId: freight.id, amount: input.amount, fromFinancialAccountId: from, description, payee: input.payee ?? null, costBehaviour: "VARIABLE" }, actor, keys.cost);
          result = { source: "Expense", id: expense.id, title: description };
          break;
        }
        let ids = input.goodsReceiptIds ?? [];
        if (!ids.length) {
          const last = await tx.goodsReceipt.findFirst({ where: { businessId: business.id, status: "POSTED" }, orderBy: [{ receiptDate: "desc" }, { number: "desc" }], select: { id: true } });
          if (!last) throw financeError(400, "NO_PURCHASE", "There is no purchase to add it to — record the goods first");
          ids = [last.id];
        }
        const { row, eventId } = await createLandedCostInTx(tx, business, { costDate: date, description, payee: input.payee ?? null, amount: input.amount, method: "VALUE", goodsReceiptIds: ids, fromFinancialAccountId: from }, actor, keys.cost);
        result = { source: "LandedCost", id: row.id, title: description, after: eventId ? () => processFinancialEvent(eventId) : undefined };
        break;
      }
      case "EQUIPMENT": {
        if (!note) throw financeError(400, "NOTE_REQUIRED", "Say what it is (printer, laptop…)");
        const life = input.usefulLifeMonths ?? 36;
        if (!Number.isInteger(life) || life < 1 || life > 600) throw financeError(400, "USEFUL_LIFE", "It lasts 1 to 600 months");
        const asset = input.assetAccountId
          ? await tx.ledgerAccount.findFirst({ where: { id: input.assetAccountId, businessId: business.id, type: "ASSET", isPostable: true, code: { gte: "1800", lt: "1890" } } })
          : await tx.ledgerAccount.findFirst({ where: { businessId: business.id, type: "ASSET", isPostable: true, isActive: true, code: { gte: "1800", lt: "1890" } }, orderBy: { code: "asc" } });
        if (!asset) throw financeError(400, "ASSET_ACCOUNT", "Choose what kind of equipment it is");
        if (owner) await fund(from, note);
        const { movement } = await requestMovementInTx(tx, business, { kind: "WITHDRAWAL", movementDate: date, amount: input.amount, fromFinancialAccountId: from, counterAccountId: asset.id, description: `Bought ${note}${input.payee ? ` · ${input.payee}` : ""}`.slice(0, 300) }, actor, keys.cost);
        if (movement.status !== "POSTED") throw financeError(409, "PAYMENT_NEEDS_APPROVAL", "The payment waits for approval — record equipment once it is paid");
        const created = await createAssetInTx(tx, business, { name: note, assetAccountId: asset.id, acquisitionDate: date, cost: input.amount, usefulLifeMonths: life, sourceType: "MONEY_MOVEMENT", sourceRef: movement.id }, actor);
        result = { source: "FixedAsset", id: created.id, title: note };
        break;
      }
      case "ADS": {
        const ad = input.adAccountId
          ? await tx.financialAccount.findFirst({ where: { id: input.adAccountId, businessId: business.id, kind: "AD_PLATFORM", isActive: true } })
          : await tx.financialAccount.findFirst({ where: { businessId: business.id, kind: "AD_PLATFORM", isActive: true }, orderBy: { createdAt: "asc" } });
        if (!ad) throw financeError(400, "NO_AD_ACCOUNT", "Add the ad account first (Money › Ads)");
        const description = note ?? `${ad.name} paid by card`;
        if (owner) {
          // The card is the owner's: his money goes straight into the ad account.
          const m = await fundFromOwnerInTx(tx, business, { toFinancialAccountId: ad.id, amount: input.amount, date, description, funding: funding! }, actor, keys.cost);
          fundingId = m.id;
          result = { source: "AdTopUp", id: m.id, title: description };
        } else {
          const { movement } = await requestMovementInTx(tx, business, { kind: "TRANSFER", movementDate: date, amount: input.amount, fromFinancialAccountId: from, toFinancialAccountId: ad.id, description }, actor, keys.cost);
          result = { source: "AdTopUp", id: movement.id, title: description };
        }
        break;
      }
      default:
        throw financeError(400, "COST_KIND", "Choose what the cost is");
    }
    if (funding === "REIMBURSE" && fundingId) {
      await recordOwnerAdvanceInTx(tx, business, { fundingMovementId: fundingId, sourceType: result.source as OwnerAdvanceSource, sourceId: result.id, amount: input.amount, date, description: result.title }, actor);
    }
    return { ...result, replayed: false };
  });
  if (!made.replayed && made.after) await made.after();
  return { cost: { source: made.source, id: made.id, kind: input.kind, label: LABEL[input.kind], title: made.title, amount: input.amount, date }, replayed: made.replayed };
}

/** What an earlier request made, from the movement its key names. */
async function madeOf(tx: AppTransactionClient, movementId: string): Promise<Made> {
  const [e, p, l, a] = await Promise.all([
    tx.expense.findUnique({ where: { movementId }, select: { id: true, description: true } }),
    tx.prepaidCost.findUnique({ where: { movementId }, select: { id: true, name: true } }),
    tx.landedCost.findUnique({ where: { movementId }, select: { id: true, description: true } }),
    tx.fixedAsset.findFirst({ where: { sourceType: "MONEY_MOVEMENT", sourceRef: movementId }, select: { id: true, name: true } }),
  ]);
  if (e) return { source: "Expense", id: e.id, title: e.description };
  if (p) return { source: "PrepaidCost", id: p.id, title: p.name };
  if (l) return { source: "LandedCost", id: l.id, title: l.description };
  if (a) return { source: "FixedAsset", id: a.id, title: a.name };
  const m = await tx.treasuryMovement.findUniqueOrThrow({ where: { id: movementId }, select: { description: true } });
  return { source: "AdTopUp", id: movementId, title: m.description };
}

// ── undo ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type UndoSource = "Expense" | "PrepaidCost" | "LandedCost";

/** The owner's money that came in for a cost, from the key of the cost's own payment (Add cost, the owner-paid expense
 * form and the expense import all name it after that key). */
async function fundingOf(tx: Prisma.TransactionClient, businessId: string, paymentKey: string) {
  const base = paymentKey.replace(/^(expense|prepaid|landed):/, "");
  const keys = [`${base}:funding`];
  return tx.treasuryMovement.findFirst({ where: { businessId, idempotencyKey: { in: keys }, status: "POSTED" }, select: { id: true } });
}

/**
 * Takes a cost back out of the books: its payment is reversed (the expense, the prepaid cost and its monthly shares, or
 * the landed cost and the stock value it added), and the owner's money that came in for it goes back out with it. The
 * records stay, marked reversed, with the reason.
 */
export async function undoCost(input: { source: UndoSource; id: string; reason: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  if (input.source === "LandedCost") {
    const l = await prisma.landedCost.findFirst({ where: { id: input.id, businessId: business.id }, select: { movementId: true, movement: { select: { idempotencyKey: true } } } });
    if (!l) throw financeError(404, "COST_NOT_FOUND", "That cost wasn't found");
    if (!actorCan(actor, "finance.post")) throw financeError(403, "COST_PERMISSION", "Undoing a carrying cost changes what stock is worth — that needs finance.post");
    const r = await cancelLandedCost(input.id, input.reason, actor);
    await financeTransaction(async (tx) => {
      const f = await fundingOf(tx, business.id, l.movement.idempotencyKey ?? "");
      if (f) await reverseMovementInTx(tx, business, f.id, { reason: input.reason }, actor);
    });
    return { undone: true, landedCost: r };
  }
  if (!actorCan(actor, "finance.reverse")) throw financeError(403, "COST_PERMISSION", "Undoing a cost needs finance.reverse");
  const row =
    input.source === "Expense"
      ? await prisma.expense.findFirst({ where: { id: input.id, businessId: business.id }, select: { movement: { select: { id: true, status: true, idempotencyKey: true } } } })
      : await prisma.prepaidCost.findFirst({ where: { id: input.id, businessId: business.id }, select: { movement: { select: { id: true, status: true, idempotencyKey: true } } } });
  if (!row) throw financeError(404, "COST_NOT_FOUND", "That cost wasn't found");
  await financeTransaction(async (tx) => {
    await reverseMovementInTx(tx, business, row.movement.id, { reason: input.reason }, actor);
    const f = await fundingOf(tx, business.id, row.movement.idempotencyKey ?? "");
    if (f) await reverseMovementInTx(tx, business, f.id, { reason: input.reason }, actor);
  });
  if (input.source === "PrepaidCost") await syncPrepaid(input.id);
  return { undone: true };
}
