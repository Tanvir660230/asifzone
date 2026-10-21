/**
 * Opening balances at the Financial Opening Date (F0-3, docs/FINANCE_PHASE_1.md §8). The books start from a statement of
 * what the business holds and owes on that date — not from replaying incomplete order history.
 *
 * One batch per business, edited as a DRAFT, posted once as a single OPENING_BALANCE journal dated on the opening date:
 *   each line (cash, bank, wallets, receivables, payables, loans, fixed assets, capital, …) on its side,
 *   + the opening inventory count's VALUED total → asset.inventory (valuation status OPENING_BALANCE),
 *   and the difference → equity.opening_balance, so the journal balances by construction.
 *
 * Inventory is never valued with an invented cost: KNOWN = backed by a supplier document, ESTIMATED = an estimate (the
 * catalog's typed cost price counts as one), MISSING = no cost — valued at 0 and reported as unvalued inventory.
 */
import type { OpeningBalanceCategory, OpeningInventoryConfidence, Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { financeTransaction } from "./finance-tx";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { resolveMappedAccount } from "./chart.service";
import { carriedIntoOpeningSql } from "./inventory-cutover.service";
import { postJournalInTx, journalDto, type JournalLineSpec } from "./journal.service";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";

const BATCH_INCLUDE = { lines: { orderBy: { lineNo: "asc" } }, inventoryItems: { orderBy: { sku: "asc" } } } satisfies Prisma.OpeningBalanceBatchInclude;
type BatchRow = Prisma.OpeningBalanceBatchGetPayload<{ include: typeof BATCH_INCLUDE }>;

const CATEGORY_TYPE: Record<OpeningBalanceCategory, "ASSET" | "LIABILITY" | "EQUITY"> = {
  CASH: "ASSET", BANK: "ASSET", MOBILE_WALLET: "ASSET", PAYMENT_ACCOUNT: "ASSET", INVENTORY: "ASSET", RECEIVABLE: "ASSET", FIXED_ASSET: "ASSET", OTHER_ASSET: "ASSET",
  PAYABLE: "LIABILITY", LOAN: "LIABILITY", OTHER_LIABILITY: "LIABILITY", CAPITAL: "EQUITY", OTHER_EQUITY: "EQUITY",
};
/** Money-holding categories must name the financial account the money is in. */
const MONEY_CATEGORY_KINDS: Partial<Record<OpeningBalanceCategory, string[]>> = {
  CASH: ["CASH"], BANK: ["BANK"], MOBILE_WALLET: ["MOBILE_WALLET"], PAYMENT_ACCOUNT: ["PAYMENT_GATEWAY", "COURIER", "OTHER", "AD_PLATFORM"],
};

const inTransaction = <T>(fn: (tx: AppTransactionClient) => Promise<T>) => financeTransaction(fn, { timeout: 60_000 });

function summarise(batch: BatchRow, currency: string) {
  let debit = 0, credit = 0;
  for (const l of batch.lines) {
    if (l.side === "DEBIT") debit += toMinor(l.amount, currency);
    else credit += toMinor(l.amount, currency);
  }
  const inv = { KNOWN: { items: 0, quantity: 0, value: 0 }, ESTIMATED: { items: 0, quantity: 0, value: 0 }, MISSING: { items: 0, quantity: 0, value: 0 }, OPENING_BALANCE: { items: 0, quantity: 0, value: 0 } };
  for (const i of batch.inventoryItems) {
    const bucket = inv[i.valuationStatus];
    bucket.items += 1;
    bucket.quantity += i.quantity;
    bucket.value += toMinor(i.valuationAmount, currency);
  }
  const inventoryValue = inv.KNOWN.value + inv.ESTIMATED.value + inv.OPENING_BALANCE.value;
  const equity = debit + inventoryValue - credit; // positive → credit opening-balance equity
  const major = (v: number) => toMajorNumber(v, currency);
  return {
    lineDebits: major(debit),
    lineCredits: major(credit),
    inventory: {
      valuedTotal: major(inventoryValue),
      known: { ...inv.KNOWN, value: major(inv.KNOWN.value) },
      estimated: { ...inv.ESTIMATED, value: major(inv.ESTIMATED.value) },
      missing: { items: inv.MISSING.items, quantity: inv.MISSING.quantity },
      /** Units on hand with no cost at all: carried at 0 until a cost is established. */
      unvaluedQuantity: inv.MISSING.quantity,
    },
    openingBalanceEquity: { side: equity >= 0 ? "CREDIT" : "DEBIT", amount: major(Math.abs(equity)) },
  };
}

function batchDto(batch: BatchRow, currency: string) {
  return {
    id: batch.id,
    status: batch.status,
    openingDate: businessDateOf(batch.openingDate),
    notes: batch.notes,
    journalEntryId: batch.journalEntryId,
    postedAt: batch.postedAt,
    lines: batch.lines.map((l) => ({ ...l, amount: toMajorNumber(toMinor(l.amount, currency), currency) })),
    inventoryItems: batch.inventoryItems.map((i) => ({
      ...i,
      unitCost: i.unitCost === null ? null : toMajorNumber(toMinor(i.unitCost, currency), currency),
      valuationAmount: toMajorNumber(toMinor(i.valuationAmount, currency), currency),
      valuationDate: businessDateOf(i.valuationDate),
    })),
    summary: summarise(batch, currency),
  };
}

export async function getOpeningBalances() {
  const { business } = await getFinanceContext();
  const batch = await prisma.openingBalanceBatch.findUnique({ where: { businessId: business.id }, include: BATCH_INCLUDE });
  return { openingDate: business.openingDate, batch: batch ? batchDto(batch, business.baseCurrency) : null };
}

/** Locks (creating when absent) the DRAFT batch. */
async function lockDraftBatch(tx: AppTransactionClient, business: FinanceBusinessInfo, actor: FinanceActor): Promise<BatchRow> {
  if (!business.openingDate) throw financeError(409, "OPENING_DATE_NOT_SET", "Set the Financial Opening Date first");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-opening:${business.id}`}))`;
  let batch = await tx.openingBalanceBatch.findUnique({ where: { businessId: business.id }, include: BATCH_INCLUDE });
  if (!batch) {
    batch = await tx.openingBalanceBatch.create({ data: { businessId: business.id, openingDate: dateColumn(business.openingDate), createdByAdminId: actor.type === "ADMIN" ? actor.adminId : null }, include: BATCH_INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "opening.create", entityType: "OpeningBalanceBatch", entityId: batch.id, after: batchDto(batch, business.baseCurrency) });
  }
  if (batch.status === "POSTED") throw financeError(409, "OPENING_POSTED", "Opening balances are posted; adjust them with a journal");
  return batch;
}

export interface OpeningLineInput {
  category: OpeningBalanceCategory;
  accountId?: string | null;
  financialAccountId?: string | null;
  side: "DEBIT" | "CREDIT";
  amount: number;
  brandId?: string | null;
  partyType?: string | null;
  partyId?: string | null;
  description?: string | null;
}

export async function saveOpeningLines(input: { notes?: string | null; lines: OpeningLineInput[] }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return inTransaction(async (tx) => {
    const before = await lockDraftBatch(tx, business, actor);
    const payablesAccountId = (await tx.accountMapping.findUnique({ where: { businessId_key: { businessId: business.id, key: "liability.payable_trade" } }, select: { accountId: true } }))?.accountId ?? null;
    const rows: Prisma.OpeningBalanceLineCreateManyInput[] = [];
    for (const [i, l] of input.lines.entries()) {
      const at = `Line ${i + 1}`;
      if (l.category === "INVENTORY") throw financeError(400, "OPENING_INVENTORY_LINE", `${at}: inventory comes from the opening inventory count, not a line`);
      let accountId = l.accountId ?? null;
      const kinds = MONEY_CATEGORY_KINDS[l.category];
      if (kinds) {
        if (!l.financialAccountId) throw financeError(400, "OPENING_FINANCIAL_ACCOUNT_REQUIRED", `${at}: choose the ${l.category.toLowerCase().replace("_", " ")} account the money is in`);
        const fa = await tx.financialAccount.findFirst({ where: { id: l.financialAccountId, businessId: business.id } });
        if (!fa || !kinds.includes(fa.kind)) throw financeError(400, "OPENING_FINANCIAL_ACCOUNT_KIND", `${at}: that financial account isn't a ${kinds.join("/").toLowerCase()} account`);
        accountId = fa.ledgerAccountId;
      }
      if (!accountId) throw financeError(400, "OPENING_ACCOUNT_REQUIRED", `${at}: choose an account`);
      const account = await tx.ledgerAccount.findFirst({ where: { id: accountId, businessId: business.id } });
      if (!account || !account.isPostable || !account.isActive) throw financeError(400, "ACCOUNT_NOT_POSTABLE", `${at}: the account can't take postings`);
      if (account.type !== CATEGORY_TYPE[l.category]) throw financeError(400, "OPENING_CATEGORY_TYPE", `${at}: a ${l.category} balance belongs on a ${CATEGORY_TYPE[l.category]} account`);
      // What is owed to a supplier sits on their payables account, so their statement, ageing and payments see it.
      if (l.partyType === "Supplier") {
        if (!l.partyId || !(await tx.supplier.findFirst({ where: { id: l.partyId, businessId: business.id }, select: { id: true } }))) throw financeError(400, "SUPPLIER_NOT_FOUND", `${at}: choose a supplier`);
      } else if (accountId === payablesAccountId) {
        throw financeError(400, "OPENING_SUPPLIER_REQUIRED", `${at}: say which supplier is owed — trade payables are kept per supplier`);
      }
      rows.push({ batchId: before.id, lineNo: i + 1, category: l.category, accountId, financialAccountId: l.financialAccountId ?? null, side: l.side, amount: toDecimal(toMinor(l.amount, cur), cur), brandId: l.brandId ?? null, partyType: l.partyType ?? null, partyId: l.partyId ?? null, description: l.description ?? null });
    }
    await tx.openingBalanceLine.deleteMany({ where: { batchId: before.id } });
    if (rows.length) await tx.openingBalanceLine.createMany({ data: rows });
    const after = await tx.openingBalanceBatch.update({ where: { id: before.id }, data: { notes: input.notes === undefined ? before.notes : input.notes }, include: BATCH_INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "opening.save_lines", entityType: "OpeningBalanceBatch", entityId: before.id, before: { lines: batchDto(before, cur).lines }, after: { lines: batchDto(after, cur).lines } });
    return batchDto(after, cur);
  });
}

export interface OpeningInventoryInput {
  variantId?: string | null;
  sku: string;
  name: string;
  quantity: number;
  unitCost?: number | null;
  valuationAmount?: number | null;
  valuationStatus: "KNOWN" | "ESTIMATED" | "MISSING";
  valuationMethod: string;
  valuationSource?: string | null;
  valuationDate: string;
  confidence?: OpeningInventoryConfidence | null;
  notes?: string | null;
  brandId?: string | null;
}

function inventoryRows(batchId: string, items: OpeningInventoryInput[], cur: string): Prisma.OpeningInventoryItemCreateManyInput[] {
  const seen = new Set<string>();
  return items.map((i) => {
    if (seen.has(i.sku)) throw financeError(400, "OPENING_DUPLICATE_SKU", `SKU ${i.sku} is listed twice`);
    seen.add(i.sku);
    const missing = i.valuationStatus === "MISSING";
    const unit = missing || i.unitCost == null ? null : toMinor(i.unitCost, cur);
    const value = missing ? 0 : i.valuationAmount != null ? toMinor(i.valuationAmount, cur) : (unit ?? 0) * i.quantity;
    return {
      batchId, variantId: i.variantId ?? null, sku: i.sku, name: i.name, quantity: i.quantity,
      unitCost: unit === null ? null : toDecimal(unit, cur), valuationAmount: toDecimal(value, cur),
      valuationStatus: i.valuationStatus, valuationMethod: i.valuationMethod, valuationSource: i.valuationSource ?? null,
      valuationDate: dateColumn(i.valuationDate), confidence: i.confidence ?? null, notes: i.notes ?? null, brandId: i.brandId ?? null,
    };
  });
}

async function replaceInventory(tx: AppTransactionClient, business: FinanceBusinessInfo, before: BatchRow, rows: Prisma.OpeningInventoryItemCreateManyInput[], actor: FinanceActor, action: string) {
  const cur = business.baseCurrency;
  await tx.openingInventoryItem.deleteMany({ where: { batchId: before.id } });
  if (rows.length) await tx.openingInventoryItem.createMany({ data: rows });
  const after = await tx.openingBalanceBatch.update({ where: { id: before.id }, data: { updatedAt: new Date() }, include: BATCH_INCLUDE });
  await recordFinanceAudit(tx, { businessId: business.id, actor, action, entityType: "OpeningBalanceBatch", entityId: before.id, before: { inventory: summarise(before, cur).inventory }, after: { inventory: summarise(after, cur).inventory, items: after.inventoryItems.length } });
  return batchDto(after, cur);
}

export async function saveOpeningInventory(items: OpeningInventoryInput[], actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const before = await lockDraftBatch(tx, business, actor);
    return replaceInventory(tx, business, before, inventoryRows(before.id, items, business.baseCurrency), actor, "opening.save_inventory");
  });
}

/**
 * Starts the count from the stock records, as they stood at the start of the opening date: today's stock with every
 * movement since then undone, plus the units out on orders the count carries (placed before the date, not yet sold on it
 * — see carriedIntoOpeningSql), which still belong to the business. Each is valued at the catalog's typed cost price as an
 * ESTIMATE (it is not backed by a supplier document), or MISSING when no cost price exists. The owner then corrects
 * quantities and costs before posting.
 */
export async function prefillOpeningInventory(actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  if (!business.openingDate) throw financeError(409, "OPENING_DATE_NOT_SET", "Set the Financial Opening Date first");
  const cur = business.baseCurrency;
  const tz = business.timezone;
  const opening = business.openingDate;
  const today = businessToday(business);
  const [variants, since, carried] = await Promise.all([
    prisma.productVariant.findMany({
      where: { product: { deletedAt: null } },
      select: { id: true, sku: true, size: true, color: true, stock: true, costPrice: true, product: { select: { name: true, costPrice: true } } },
      orderBy: { sku: "asc" },
    }),
    prisma.$queryRaw<Array<{ variantId: string; change: bigint }>>`
      SELECT m."variantId", SUM(m.change)::bigint AS change FROM "StockMovement" m
      WHERE (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date >= ${dateColumn(opening)}::date
      GROUP BY m."variantId"`,
    prisma.$queryRaw<Array<{ variantId: string; units: bigint; orders: bigint }>>`
      SELECT m."variantId", (-SUM(m.change))::bigint AS units, COUNT(DISTINCT m."orderId")::bigint AS orders
      FROM "StockMovement" m JOIN "Order" o ON o.id = m."orderId"
      WHERE (m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::date < ${dateColumn(opening)}::date
        AND ${carriedIntoOpeningSql(tz, opening)}
      GROUP BY m."variantId"`,
  ]);
  const movedSince = new Map(since.map((r) => [r.variantId, Number(r.change)]));
  const outOnOrders = new Map(carried.map((r) => [r.variantId, { units: Math.max(0, Number(r.units)), orders: Number(r.orders) }]));
  const items: OpeningInventoryInput[] = [];
  for (const v of variants) {
    const onShelf = Math.max(0, v.stock - (movedSince.get(v.id) ?? 0));
    const out = outOnOrders.get(v.id) ?? { units: 0, orders: 0 };
    const quantity = onShelf + out.units;
    if (quantity <= 0) continue;
    const cost = v.costPrice ?? v.product.costPrice;
    const costed = cost !== null && toMinor(cost, cur) > 0;
    const notes = [
      ...(onShelf !== v.stock ? [`${onShelf} on the shelf on ${opening} (${v.stock} today)`] : []),
      ...(out.units ? [`includes ${out.units} ${out.units === 1 ? "unit" : "units"} on ${out.orders === 1 ? "an order" : `${out.orders} orders`} not yet delivered or paid on ${opening}`] : []),
    ].join("; ");
    items.push({
      variantId: v.id,
      sku: v.sku,
      name: `${v.product.name} — ${v.size} / ${v.color}`.slice(0, 200),
      quantity,
      unitCost: costed ? toMajorNumber(toMinor(cost, cur), cur) : null,
      valuationStatus: costed ? "ESTIMATED" : "MISSING",
      valuationMethod: costed ? "CATALOG_COST_PRICE" : "NONE",
      valuationSource: costed ? `${v.costPrice !== null ? "Variant" : "Product"} cost price in the catalog on ${today} (typed, not purchase-verified)` : "No cost price recorded in the catalog",
      valuationDate: today,
      confidence: costed ? "LOW" : null,
      notes: notes || null,
      brandId: brand.id,
    });
  }
  return inTransaction(async (tx) => {
    const before = await lockDraftBatch(tx, business, actor);
    return replaceInventory(tx, business, before, inventoryRows(before.id, items, cur), actor, "opening.prefill_inventory");
  });
}

/** `nothingHeld`: the business held nothing on the opening date (it started later) — the batch is posted with no lines and
 * no journal, so the books start and everything after is entered on its own day. Refused when the batch has any line or
 * valued stock. */
export async function postOpeningBalances(actor: FinanceActor, opts: { nothingHeld?: boolean } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return inTransaction(async (tx) => {
    const batch = await lockDraftBatch(tx, business, actor);
    if (businessDateOf(batch.openingDate) !== business.openingDate) throw financeError(409, "OPENING_DATE_MISMATCH", "The batch date differs from the business opening date");
    if (opts.nothingHeld) {
      const s = summarise(batch, cur);
      if (batch.lines.length || s.inventory.valuedTotal > 0) throw financeError(409, "OPENING_NOT_EMPTY", "These opening balances have lines or valued stock — post them as they are");
      const after = await tx.openingBalanceBatch.update({ where: { id: batch.id }, data: { status: "POSTED", postedAt: new Date(), postedByAdminId: actor.type === "ADMIN" ? actor.adminId : null }, include: BATCH_INCLUDE });
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "opening.post_nothing_held", entityType: "OpeningBalanceBatch", entityId: batch.id, before: { status: batch.status }, after: { status: after.status, nothingHeld: true } });
      return { batch: batchDto(after, cur), journal: null };
    }
    const lines: JournalLineSpec[] = batch.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.side === "DEBIT" ? toMinor(l.amount, cur) : 0,
      credit: l.side === "CREDIT" ? toMinor(l.amount, cur) : 0,
      brandId: l.brandId,
      partyType: l.partyType,
      partyId: l.partyId,
      memo: l.description ?? l.category,
    }));
    const summary = summarise(batch, cur);
    const inventoryMinor = toMinor(summary.inventory.valuedTotal, cur);
    if (inventoryMinor > 0) {
      const inventoryAccount = await resolveMappedAccount(tx, business.id, "asset.inventory");
      lines.push({ accountId: inventoryAccount.id, debit: inventoryMinor, credit: 0, valuationStatus: "OPENING_BALANCE", memo: `Opening inventory: ${batch.inventoryItems.length} SKU(s); ${summary.inventory.missing.items} without cost (${summary.inventory.unvaluedQuantity} unit(s) unvalued)` });
    }
    const equityMinor = toMinor(summary.openingBalanceEquity.amount, cur);
    if (equityMinor > 0) {
      const equityAccount = await resolveMappedAccount(tx, business.id, "equity.opening_balance");
      lines.push({ accountId: equityAccount.id, debit: summary.openingBalanceEquity.side === "DEBIT" ? equityMinor : 0, credit: summary.openingBalanceEquity.side === "CREDIT" ? equityMinor : 0, memo: "Balancing opening balance equity" });
    }
    if (lines.length < 2) throw financeError(400, "OPENING_EMPTY", "Enter at least one opening balance or a valued inventory count before posting");
    const { entry } = await postJournalInTx(tx, business, {
      entryDate: business.openingDate!,
      description: `Opening balances at ${business.openingDate}`,
      kind: "OPENING_BALANCE",
      lines,
      sourceType: "OpeningBalanceBatch",
      sourceId: batch.id,
      idempotencyKey: `opening:${batch.id}`,
    }, actor);
    const after = await tx.openingBalanceBatch.update({ where: { id: batch.id }, data: { status: "POSTED", journalEntryId: entry.id, postedAt: new Date(), postedByAdminId: actor.type === "ADMIN" ? actor.adminId : null }, include: BATCH_INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "opening.post", entityType: "OpeningBalanceBatch", entityId: batch.id, before: { status: batch.status }, after: { status: after.status, journalEntryId: entry.id, summary } });
    return { batch: batchDto(after, cur), journal: journalDto(entry) };
  });
}

/** What each supplier was owed in the posted opening balances (minor units, credit positive): the opening lines on the
 * trade-payables account that name the supplier. Their statement, the payables ageing and the subledger check count it
 * like a bill dated on the opening date. */
export async function supplierOpeningDues(db: AppTransactionClient | typeof prisma, businessId: string, payablesAccountId: string, currency: string, supplierId?: string): Promise<Map<string, number>> {
  const lines = await db.openingBalanceLine.findMany({
    where: { accountId: payablesAccountId, partyType: "Supplier", ...(supplierId ? { partyId: supplierId } : {}), batch: { businessId, status: "POSTED" } },
    select: { partyId: true, side: true, amount: true },
  });
  const out = new Map<string, number>();
  for (const l of lines) out.set(l.partyId!, (out.get(l.partyId!) ?? 0) + (l.side === "CREDIT" ? 1 : -1) * toMinor(l.amount, currency));
  return out;
}
