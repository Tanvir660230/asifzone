/**
 * Stock hub — Bought (docs/STOCK_HUB.md §2): one form for a purchase, composed of the documents purchasing and payables
 * already have, never re-implemented here:
 *
 *   1. supplier       found by name, or created ("Local market" when none is given); one on hold is refused  suppliers.service
 *   2. receipt        a direct goods receipt (no purchase order; reason "Bought — stock hub"),
 *                     posted: stock and value in at the line totals paid                        goods-receipts.service
 *   3. bill           a supplier invoice matched line by line to that receipt, posted: it
 *                     clears GRNI at exactly the receipt's value (no price difference)          supplier-invoices.service
 *   4. funding        paid from the owner's own money only (owner-only: finance.sensitive, like POST /equity/owner/money):
 *                     his money comes into his "<owner> — own money" cash account as capital
 *                     first (made the first time, as the owner's history does)                  partner-profit.service ownerMoney
 *   5. payment        the bill paid from that account                                           supplier-payments.service
 *   6. extras         transport, customs… one landed cost spread over the receipt by value,
 *                     paid from the same account                                                landed-costs.service
 *
 * A line total that isn't a whole number of the smallest currency unit per item (৳1,000 for 3) is received as two lines
 * (2 × 333.33 + 1 × 333.34), so stock, bill and payment are exactly what was paid.
 *
 * Before the first write, what would stop it mid-way is checked (advisory): the date is in open books (on or after the
 * opening date, its month not closed), the supplier isn't on hold, and a cash box or wallet holds what is still to be paid
 * (a bank may go overdrawn, as in treasury). Nothing is written when one fails.
 *
 * Each step is idempotent by `stock-purchase:<key>:<step>` (treasury keys; receipt and bill carry it as their evidence,
 * unique in the database among live documents), and the entry (hub-entry.ts) records what each step made under a fenced
 * lease: a retry after a mid-way failure resumes, a replay writes nothing, a request that outlived its lease stops. An
 * entry stuck mid-way (the money moved meanwhile) is finished with POST /stock/purchases/:id/finish, from the same or —
 * while nothing has been paid yet — another account. Stock documents need costing (decision D-P1): before go-live the
 * purchase is refused with the reason.
 */
import { monthPeriod, goodsReceiptCreateSchema, stockPurchaseFinishSchema, stockPurchaseSchema, supplierCreateSchema, supplierInvoiceCreateSchema, type StockPurchaseFinishInput, type StockPurchaseInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { actorCan, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "../finance/finance-context";
import { businessDateOf, dateColumn, financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { createSupplier } from "../finance/suppliers.service";
import { createGoodsReceipt, postGoodsReceipt } from "../finance/goods-receipts.service";
import { createSupplierInvoice, postSupplierInvoice } from "../finance/supplier-invoices.service";
import { paySupplier } from "../finance/supplier-payments.service";
import { createLandedCost } from "../finance/landed-costs.service";
import { ownerMoney } from "../finance/partner-profit.service";
import { createFinancialAccount } from "../finance/financial-accounts.service";
import { moneyBalanceAt } from "../finance/ledger.service";
import { claimEntry, claimEntryById, completeEntry, findEntry, fingerprintOf, isUniqueViolation, releaseEntry, renewLease, saveSteps, unitOf, variantLabel, type Lease } from "./hub-entry";

export type { StockPurchaseInput, StockPurchaseFinishInput };

export const PURCHASE_REASON = "Bought — stock hub";
const DEFAULT_SUPPLIER = "Local market";
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
/** Accounts that can't go below zero (treasury's rule): a purchase from one is checked for money before anything is written. */
const NO_OVERDRAFT = new Set(["CASH", "MOBILE_WALLET"]);
/** What the composition posts: the receipt (receiving and, without an order, its approval), the bill and the payments. */
const NEEDS = ["purchasing.receive", "purchasing.approve", "ap.manage", "finance.transact"] as const;
const KEY_PREFIX = "purchase:";

type PaidFrom = { kind: "ACCOUNT" | "OWNER"; financialAccountId: string; name: string };
interface PurchaseSteps {
  request: {
    supplierName: string;
    reference: string | null;
    note: string | null;
    lines: Array<{ variantId: string; name: string; unit: string; quantity: number; amount: number }>;
    extras: Array<{ description: string; amount: number }>;
    paidFrom: PaidFrom;
  };
  goods: number;
  extras: number;
  total: number;
  supplierId?: string;
  receiptId?: string;
  receiptNumber?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  fundingMovementId?: string;
  paymentMovementId?: string;
  paymentStatus?: string;
  landedCostId?: string | null;
}
export type PurchaseStep = "supplier" | "receipt" | "invoice" | "funding" | "payment" | "extras";

const tag = (key: string, step: string) => `stock-purchase:${key}:${step}`;

/** Splits a line total into receipt lines whose unit costs are whole minor units and add up to exactly the total. */
export function exactLines(quantity: number, amountMinor: number): Array<{ qty: number; unitMinor: number }> {
  const base = Math.floor(amountMinor / quantity);
  const rest = amountMinor - base * quantity;
  if (!rest) return [{ qty: quantity, unitMinor: base }];
  return [{ qty: quantity - rest, unitMinor: base }, { qty: rest, unitMinor: base + 1 }];
}

/** The step an unfinished purchase waits on (null once complete). */
export function pendingStep(s: PurchaseSteps, complete: boolean): PurchaseStep | null {
  if (complete) return null;
  if (!s.supplierId) return "supplier";
  if (!s.receiptId || !s.receiptNumber) return "receipt";
  if (!s.invoiceId || !s.invoiceNumber) return "invoice";
  if (s.request.paidFrom.kind === "OWNER" && !s.fundingMovementId) return "funding";
  if (!s.paymentMovementId) return "payment";
  return "extras";
}

/** Money has moved for this purchase (funding, payment or extras): who pays can't change any more. */
const moneyMoved = (s: PurchaseSteps) => Boolean(s.fundingMovementId || s.paymentMovementId || s.landedCostId);

/** What is still to be paid, in minor units: the bill unless paid, the extras unless booked. */
function stillToPay(s: PurchaseSteps, cur: string): number {
  return (s.paymentMovementId ? 0 : toMinor(s.goods, cur)) + (s.landedCostId !== undefined ? 0 : toMinor(s.extras, cur));
}

/** Under the claimed lease, before any step runs: the actor may pay the way the entry now stores (a resumed entry runs its
 * stored `paidFrom`, which /finish may have set to the owner's own money). Refused → the lease is released, nothing written. */
async function assertCanRunStored(lease: Lease, steps: PurchaseSteps, actor: FinanceActor) {
  try {
    assertCan(actor, steps.request.paidFrom.kind === "OWNER");
  } catch (err) {
    await releaseEntry(lease);
    throw err;
  }
}

function assertCan(actor: FinanceActor, ownerPocket: boolean) {
  const missing = [...NEEDS, ...(ownerPocket ? (["finance.sensitive"] as const) : [])].filter((p) => !actorCan(actor, p));
  if (!missing.length) return;
  throw financeError(403, "STOCK_PURCHASE_PERMISSION", ownerPocket && missing.includes("finance.sensitive") && missing.length === 1
    ? "Paying from the owner's own money books his capital — only the owner (finance.sensitive) can"
    : `Recording a purchase posts its receipt, bill and payment — that needs ${missing.join(", ")}`);
}

const pocketName = (owner: string | null) => `${owner ?? "Owner"} — own money`;

/** The owner's own money: his "<owner> — own money" cash account (the owner's history), or null when not made yet. Never
 * another cash box. */
async function findOwnerPocket(businessId: string) {
  const owner = await prisma.partner.findFirst({ where: { businessId, role: "OWNER" }, select: { name: true } });
  const name = pocketName(owner?.name ?? null);
  const fa = await prisma.financialAccount.findFirst({ where: { businessId, name }, select: { id: true, name: true, kind: true, isActive: true } });
  if (fa && (fa.kind !== "CASH" || !fa.isActive)) throw financeError(409, "OWNER_POCKET_UNUSABLE", `"${name}" must be an active cash account — the owner's own money passes through it`);
  return { name, account: fa };
}

/** The owner's own-money account, made the first time (as the owner's history script does). */
async function ensureOwnerPocket(businessId: string, actor: FinanceActor): Promise<PaidFrom> {
  const { name, account } = await findOwnerPocket(businessId);
  if (account) return { kind: "OWNER", financialAccountId: account.id, name: account.name };
  try {
    const created = await createFinancialAccount({ kind: "CASH", name, metadata: { purpose: "Costs the owner pays from his own pocket: put in and paid out the same day" } }, actor);
    return { kind: "OWNER", financialAccountId: created.id, name };
  } catch (err) {
    // two first purchases at once: the other made it
    const again = await prisma.financialAccount.findFirst({ where: { businessId, name }, select: { id: true } });
    if (again) return { kind: "OWNER", financialAccountId: again.id, name };
    throw err;
  }
}

/** Who pays, from the request: an account (cash, bank or wallet) or the owner's own money (`account` null: made later). */
async function resolvePaidFrom(businessId: string, paidFrom: StockPurchaseFinishInput["paidFrom"] & object): Promise<PaidFrom | { kind: "OWNER"; financialAccountId: null; name: string }> {
  if ("ownerPocket" in paidFrom) {
    const { name, account } = await findOwnerPocket(businessId);
    return account ? { kind: "OWNER", financialAccountId: account.id, name: account.name } : { kind: "OWNER", financialAccountId: null, name };
  }
  const fa = await prisma.financialAccount.findFirst({ where: { id: paidFrom.financialAccountId, businessId }, select: { id: true, name: true, kind: true, isActive: true } });
  if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "That money account doesn't exist");
  if (!fa.isActive || !PAYING_KINDS.has(fa.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", `${fa.name} can't pay — pay from cash, a bank or a wallet`);
  return { kind: "ACCOUNT", financialAccountId: fa.id, name: fa.name };
}

const onHold = (s: { displayName: string; statusReason: string | null }) =>
  financeError(409, "SUPPLIER_ON_HOLD", `${s.displayName} is on hold${s.statusReason ? ` (${s.statusReason})` : ""} — nothing is bought from or paid to it until it is released in Suppliers`);

/** The supplier a name picks: an active one; one on hold is refused; none → made later (null). */
async function supplierByName(businessId: string, name: string): Promise<string | null> {
  const found = await prisma.supplier.findMany({ where: { businessId, displayName: { equals: name, mode: "insensitive" }, status: { not: "INACTIVE" } }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, displayName: true, statusReason: true } });
  const active = found.find((s) => s.status === "ACTIVE");
  if (active) return active.id;
  const held = found.find((s) => s.status === "ON_HOLD");
  if (held) throw onHold(held);
  return null;
}

async function assertSupplierUsable(id: string) {
  const s = await prisma.supplier.findUniqueOrThrow({ where: { id }, select: { status: true, displayName: true, statusReason: true } });
  if (s.status === "ON_HOLD") throw onHold(s);
}

/** The date is in open books: on or after the opening date, its month not closed (soft-closed: period closers only) —
 * the rules journal posting enforces, read without writing. */
async function assertBooksOpen(business: FinanceBusinessInfo, date: string, actor: FinanceActor) {
  if (!business.openingDate) throw financeError(409, "OPENING_DATE_NOT_SET", "Set the Financial Opening Date before recording purchases");
  if (date < business.openingDate) throw financeError(409, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}; a purchase can't be dated before it`, { openingDate: business.openingDate });
  const period = await prisma.financialPeriod.findUnique({ where: { businessId_startDate: { businessId: business.id, startDate: dateColumn(monthPeriod(date).startDate) } }, select: { status: true, startDate: true } });
  if (period?.status === "CLOSED") throw financeError(409, "PERIOD_CLOSED", `The month starting ${businessDateOf(period.startDate)} is closed — date the purchase in an open month`);
  if (period?.status === "SOFT_CLOSED" && !actorCan(actor, "finance.period_close")) {
    throw financeError(409, "PERIOD_SOFT_CLOSED", `The month starting ${businessDateOf(period.startDate)} is soft-closed; only a period closer may record into it`);
  }
}

/** A cash box or wallet holds what is still to be paid (treasury's no-overdraft rule, checked before anything is written). */
async function assertMoneyFor(business: FinanceBusinessInfo, paidFrom: { kind: string; financialAccountId: string | null }, neededMinor: number) {
  if (paidFrom.kind !== "ACCOUNT" || !paidFrom.financialAccountId || neededMinor <= 0) return;
  const fa = await prisma.financialAccount.findUniqueOrThrow({ where: { id: paidFrom.financialAccountId }, select: { name: true, kind: true, ledgerAccountId: true } });
  if (!NO_OVERDRAFT.has(fa.kind)) return;
  const cur = business.baseCurrency;
  const balance = await moneyBalanceAt(prisma, business.id, fa.ledgerAccountId, cur, null);
  if (balance < neededMinor) {
    throw financeError(409, "INSUFFICIENT_FUNDS", `${fa.name} holds ${toMajorNumber(balance, cur)} but this purchase needs ${toMajorNumber(neededMinor, cur)} — top it up or pay from another account`, {
      balance: toMajorNumber(balance, cur), needed: toMajorNumber(neededMinor, cur),
    });
  }
}

async function assertCostingLive(businessId: string) {
  const biz = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: businessId }, select: { inventoryCostingActivatedAt: true } });
  if (!biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_NOT_ACTIVE", "Stock costing starts at go-live — purchases are recorded here once the stock has been valued");
}

/** Records a purchase (see the file header). Returns the documents it made; `replayed` when the key had already finished. */
export async function recordPurchase(raw: StockPurchaseInput, actor: FinanceActor, key: string | null) {
  if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every purchase");
  const input = stockPurchaseSchema.parse(raw);
  assertCan(actor, "ownerPocket" in input.paidFrom);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  await assertCostingLive(business.id);
  const today = businessToday(business);
  if (input.date && input.date > today) throw financeError(400, "PURCHASE_IN_FUTURE", "A purchase records goods already received");

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: input.lines.map((l) => l.variantId) } },
    select: { id: true, size: true, color: true, product: { select: { name: true, kind: true, stockUnit: true, trackInventory: true, deletedAt: true } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  for (const [i, l] of input.lines.entries()) {
    const v = byId.get(l.variantId);
    if (!v || v.product.deletedAt) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${i + 1}: item not found`);
    if (!v.product.trackInventory) throw financeError(400, "PURCHASE_UNTRACKED", `Line ${i + 1}: ${variantLabel(v)} isn't stock-tracked`);
    if (toMinor(l.amount, cur) < l.quantity) throw financeError(400, "PURCHASE_LINE_AMOUNT", `Line ${i + 1}: the total is less than the smallest coin per unit`);
  }

  const fingerprint = fingerprintOf(input);
  const existing = await findEntry(business.id, "PURCHASE", key);
  if (existing && existing.fingerprint !== fingerprint) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different entry");
  if (existing?.completedAt) return outcome(existing.id, existing.steps as unknown as PurchaseSteps, true, existing);

  // Before the first write: what would stop the purchase mid-way. A resumed entry is checked for what is left of it.
  const supplierName = input.supplierName ?? DEFAULT_SUPPLIER;
  const date = input.date ?? today;
  const goodsMinor = input.lines.reduce((s, l) => s + toMinor(l.amount, cur), 0);
  const extrasMinor = input.extras.reduce((s, e) => s + toMinor(e.amount, cur), 0);
  if (existing) {
    const s = existing.steps as unknown as PurchaseSteps;
    // What runs is the stored way of paying — /finish may have switched it to the owner's own money since.
    assertCan(actor, s.request.paidFrom.kind === "OWNER");
    if (s.supplierId) await assertSupplierUsable(s.supplierId);
    else await supplierByName(business.id, s.request.supplierName);
    await assertBooksOpen(business, businessDateOf(existing.entryDate), actor);
    await assertMoneyFor(business, s.request.paidFrom, stillToPay(s, cur));
  } else {
    await supplierByName(business.id, supplierName);
    await assertBooksOpen(business, date, actor);
    await assertMoneyFor(business, await resolvePaidFrom(business.id, input.paidFrom), goodsMinor + extrasMinor);
  }

  let paidFrom: PaidFrom;
  if ("ownerPocket" in input.paidFrom) paidFrom = existing ? (existing.steps as unknown as PurchaseSteps).request.paidFrom : await ensureOwnerPocket(business.id, actor);
  else paidFrom = (await resolvePaidFrom(business.id, input.paidFrom)) as PaidFrom;

  const initial: PurchaseSteps = {
    request: {
      supplierName, reference: input.reference, note: input.note,
      lines: input.lines.map((l) => {
        const v = byId.get(l.variantId)!;
        return { variantId: l.variantId, name: variantLabel(v), unit: unitOf(v.product), quantity: l.quantity, amount: l.amount };
      }),
      extras: input.extras, paidFrom,
    },
    goods: toMajorNumber(goodsMinor, cur), extras: toMajorNumber(extrasMinor, cur), total: toMajorNumber(goodsMinor + extrasMinor, cur),
  };
  const { entry, done, lease } = await claimEntry({ businessId: business.id, kind: "PURCHASE", key, fingerprint, entryDate: date, steps: initial as never, actor });
  if (done || !lease) return outcome(entry.id, entry.steps as unknown as PurchaseSteps, true, entry);
  await assertCanRunStored(lease, entry.steps as unknown as PurchaseSteps, actor);
  return runSteps(lease, entry, key, actor);
}

/**
 * Finishes a purchase stuck mid-way (e.g. the money moved between the check and the payment): the remaining steps run,
 * from `paidFrom` when given — another account is allowed only while nothing has been paid for this purchase. Idempotent:
 * a finished purchase is returned as it is (`replayed`).
 */
export async function finishPurchase(id: string, raw: StockPurchaseFinishInput, actor: FinanceActor) {
  const input = stockPurchaseFinishSchema.parse(raw);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const found = await prisma.stockHubEntry.findFirst({ where: { id, businessId: business.id, kind: "PURCHASE" } });
  if (!found) throw financeError(404, "STOCK_ENTRY_NOT_FOUND", "That purchase doesn't exist");
  if (found.completedAt) return outcome(found.id, found.steps as unknown as PurchaseSteps, true, found);
  const s = found.steps as unknown as PurchaseSteps;

  const wanted = input.paidFrom ? await resolvePaidFrom(business.id, input.paidFrom) : s.request.paidFrom;
  const changes = wanted.kind !== s.request.paidFrom.kind || (wanted.financialAccountId !== null && wanted.financialAccountId !== s.request.paidFrom.financialAccountId);
  if (changes && moneyMoved(s)) throw financeError(409, "PAID_FROM_LOCKED", `Part of this purchase was already paid from ${s.request.paidFrom.name} — finish it from there`);
  assertCan(actor, wanted.kind === "OWNER");
  await assertCostingLive(business.id);
  if (s.supplierId) await assertSupplierUsable(s.supplierId);
  else await supplierByName(business.id, s.request.supplierName);
  await assertBooksOpen(business, businessDateOf(found.entryDate), actor);
  await assertMoneyFor(business, wanted, stillToPay(s, cur));
  const paidFrom: PaidFrom = wanted.kind === "OWNER" && wanted.financialAccountId === null ? await ensureOwnerPocket(business.id, actor) : (wanted as PaidFrom);

  const { entry, done, lease } = await claimEntryById(business.id, "PURCHASE", id);
  if (done || !lease) return outcome(entry.id, entry.steps as unknown as PurchaseSteps, true, entry);
  const steps = entry.steps as unknown as PurchaseSteps;
  if (!changes) await assertCanRunStored(lease, steps, actor);
  if (changes) {
    if (moneyMoved(steps)) {
      await releaseEntry(lease);
      throw financeError(409, "PAID_FROM_LOCKED", `Part of this purchase was already paid from ${steps.request.paidFrom.name} — finish it from there`);
    }
    steps.request.paidFrom = paidFrom;
    try {
      await saveSteps(lease, steps as never);
    } catch (err) {
      await releaseEntry(lease);
      throw err;
    }
  }
  return runSteps(lease, { ...entry, steps: steps as never }, found.idempotencyKey.slice(KEY_PREFIX.length), actor);
}

/** Finds a stamped document, else creates it; a create that loses a race to the stamp's unique index finds the winner. */
async function onceByStamp(find: () => Promise<{ id: string } | null>, create: () => Promise<{ id: string }>): Promise<string> {
  const stamped = await find();
  if (stamped) return stamped.id;
  try {
    return (await create()).id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await find();
      if (winner) return winner.id;
    }
    throw err;
  }
}

/** The steps not yet done, under this request's lease (each step renews it first). */
async function runSteps(lease: Lease, entry: { id: string; steps: unknown; entryDate: Date; createdAt: Date; completedAt: Date | null }, key: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const steps = entry.steps as PurchaseSteps;
  const date = businessDateOf(entry.entryDate);
  const req = steps.request;
  const save = () => saveSteps(lease, steps as never);
  try {
    // 1. supplier (never one on hold)
    if (!steps.supplierId) {
      await renewLease(lease);
      steps.supplierId = (await supplierByName(business.id, req.supplierName))
        ?? (await createSupplier(supplierCreateSchema.parse({ legalName: req.supplierName, displayName: req.supplierName, notes: "Created from the stock hub (Bought)" }), actor)).id;
      await save();
    } else await assertSupplierUsable(steps.supplierId);

    // 2. the goods receipt, posted
    if (!steps.receiptId) {
      await renewLease(lease);
      steps.receiptId = await onceByStamp(
        () => prisma.goodsReceipt.findFirst({ where: { businessId: business.id, evidence: tag(key, "receipt"), status: { not: "REVERSED" } }, select: { id: true } }),
        () => createGoodsReceipt(goodsReceiptCreateSchema.parse({
          supplierId: steps.supplierId, receiptDate: date, supplierRef: req.reference, notes: req.note, evidence: tag(key, "receipt"), directReason: PURCHASE_REASON,
          lines: req.lines.flatMap((l) => exactLines(l.quantity, toMinor(l.amount, cur)).map((x) => ({ variantId: l.variantId, qtyAccepted: x.qty, unitCost: toMajorNumber(x.unitMinor, cur) }))),
        }), actor),
      );
      await save();
    }
    await renewLease(lease);
    const posted = await postGoodsReceipt(steps.receiptId, {}, actor);
    if (steps.receiptNumber !== posted.receipt.number) {
      steps.receiptNumber = posted.receipt.number;
      await save();
    }

    // 3. the bill, matched line by line to the receipt, posted
    if (!steps.invoiceId) {
      await renewLease(lease);
      steps.invoiceId = await onceByStamp(
        () => prisma.supplierInvoice.findFirst({ where: { businessId: business.id, evidence: tag(key, "invoice"), status: { not: "VOID" } }, select: { id: true } }),
        () => createSupplierInvoice(supplierInvoiceCreateSchema.parse({
          kind: "INVOICE", supplierId: steps.supplierId, supplierRef: steps.receiptNumber, invoiceDate: date, dueDate: date,
          notes: [req.reference ? `Supplier's ref. ${req.reference}` : null, req.note].filter(Boolean).join(" · ") || null, evidence: tag(key, "invoice"),
          lines: posted.receipt.lines.map((l) => ({ lineType: "STOCK", goodsReceiptLineId: l.id, quantity: l.qtyAccepted, unitPrice: l.unitCost })),
        }), actor),
      );
      await save();
    }
    await renewLease(lease);
    const bill = await postSupplierInvoice(steps.invoiceId, {}, actor);
    if (steps.invoiceNumber !== bill.invoice.number) {
      steps.invoiceNumber = bill.invoice.number;
      await save();
    }

    // 4. the owner's own money comes in as capital first
    if (req.paidFrom.kind === "OWNER" && !steps.fundingMovementId) {
      await renewLease(lease);
      const what = req.lines.map((l) => `${l.quantity} ${l.unit} ${l.name}`).join(", ");
      const { movement } = await ownerMoney({ kind: "INVEST", financialAccountId: req.paidFrom.financialAccountId, amount: steps.total, date, note: `Bought ${steps.receiptNumber}: ${what}`.slice(0, 200) }, actor, tag(key, "funding"));
      if (movement.status !== "POSTED") throw financeError(409, "FUNDING_NEEDS_APPROVAL", "The owner's money must post before the purchase can be paid from it — approve it, then finish the purchase");
      steps.fundingMovementId = movement.id;
      await save();
    }

    // 5. the bill paid
    if (!steps.paymentMovementId) {
      await renewLease(lease);
      const { payment } = await paySupplier({
        supplierId: steps.supplierId, fromFinancialAccountId: req.paidFrom.financialAccountId, movementDate: date, amount: steps.goods, reference: steps.invoiceNumber ?? null,
        allocations: [{ invoiceId: steps.invoiceId, amount: steps.goods }],
      }, actor, tag(key, "payment"));
      steps.paymentMovementId = payment.id;
      steps.paymentStatus = payment.status;
      await save();
    }

    // 6. extras onto the goods, by value
    if (steps.landedCostId === undefined) {
      await renewLease(lease);
      steps.landedCostId = req.extras.length
        ? (await createLandedCost({
          costDate: date, description: req.extras.map((e) => e.description).join(", ").slice(0, 300), payee: null, amount: steps.extras, method: "VALUE",
          goodsReceiptIds: [steps.receiptId], fromFinancialAccountId: req.paidFrom.financialAccountId, reference: steps.receiptNumber ?? null,
        }, actor, tag(key, "extras"))).landedCost.id
        : null;
    }
    const finished = await completeEntry(lease, steps as never);
    return outcome(entry.id, steps, false, finished);
  } catch (err) {
    await releaseEntry(lease);
    throw err;
  }
}

async function outcome(id: string, steps: PurchaseSteps, replayed: boolean, entry: { entryDate: Date; createdAt: Date; completedAt: Date | null }) {
  const live = await paymentStatuses([steps]);
  return { receiptId: steps.receiptId ?? null, invoiceId: steps.invoiceId ?? null, landedCostId: steps.landedCostId ?? null, replayed, purchase: purchaseDto(id, steps, entry, { canSeeCost: true, live }) };
}

/** The payments' statuses as they are now (a payment may be approved, or reversed, after the purchase). */
async function paymentStatuses(all: PurchaseSteps[]): Promise<Map<string, string>> {
  const ids = all.map((s) => s.paymentMovementId).filter((x): x is string => Boolean(x));
  if (!ids.length) return new Map();
  const rows = await prisma.treasuryMovement.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  return new Map(rows.map((r) => [r.id, r.status as string]));
}

function purchaseDto(id: string, s: PurchaseSteps, e: { entryDate: Date; createdAt: Date; completedAt: Date | null }, view: { canSeeCost: boolean; live: Map<string, string> }) {
  const money = (n: number) => (view.canSeeCost ? n : null);
  const complete = Boolean(e.completedAt);
  return {
    id,
    date: businessDateOf(e.entryDate),
    supplier: { id: s.supplierId ?? null, name: s.request.supplierName },
    reference: s.request.reference,
    note: s.request.note,
    lines: s.request.lines.map((l) => ({ ...l, amount: money(l.amount), unitCost: money(Math.round((l.amount / l.quantity) * 100) / 100) })),
    extrasLines: s.request.extras.map((x) => ({ description: x.description, amount: money(x.amount) })),
    goods: money(s.goods),
    extras: money(s.extras),
    total: money(s.total),
    paidFrom: s.request.paidFrom,
    receipt: s.receiptId ? { id: s.receiptId, number: s.receiptNumber ?? null } : null,
    invoice: s.invoiceId ? { id: s.invoiceId, number: s.invoiceNumber ?? null } : null,
    /** The payment's status now (POSTED, PENDING_APPROVAL, REVERSED…); null until it is made. */
    paymentStatus: s.paymentMovementId ? view.live.get(s.paymentMovementId) ?? s.paymentStatus ?? null : null,
    landedCostId: s.landedCostId ?? null,
    /** False: a step failed (e.g. the money moved meanwhile) — POST /stock/purchases/:id/finish completes it. */
    complete,
    /** The step it waits on while incomplete: supplier, receipt, invoice, funding, payment or extras. */
    pendingStep: pendingStep(s, complete),
    createdAt: e.createdAt,
  };
}
export type StockPurchaseDto = ReturnType<typeof purchaseDto>;

/** Recent purchases from the hub, newest first. Amounts and unit costs only with costing.read. */
export async function listPurchases(q: { limit?: number } = {}, viewer: { canSeeCost: boolean } = { canSeeCost: false }) {
  const { business } = await getFinanceContext();
  const rows = await prisma.stockHubEntry.findMany({ where: { businessId: business.id, kind: "PURCHASE" }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }], take: q.limit ?? 50 });
  const steps = rows.map((r) => r.steps as unknown as PurchaseSteps);
  const live = await paymentStatuses(steps);
  return { purchases: rows.map((r, i) => purchaseDto(r.id, steps[i]!, r, { canSeeCost: viewer.canSeeCost, live })) };
}

/** One purchase (e.g. to see what an incomplete one waits on). */
export async function getPurchase(id: string, viewer: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const row = await prisma.stockHubEntry.findFirst({ where: { id, businessId: business.id, kind: "PURCHASE" } });
  if (!row) throw financeError(404, "STOCK_ENTRY_NOT_FOUND", "That purchase doesn't exist");
  const steps = row.steps as unknown as PurchaseSteps;
  return { purchase: purchaseDto(row.id, steps, row, { canSeeCost: viewer.canSeeCost, live: await paymentStatuses([steps]) }) };
}
