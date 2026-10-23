/**
 * The valuation cutover (Financial Core Phase 4C, docs/FINANCE_PHASE_4C.md) — the one-time, owner-approved step that makes
 * inventory costing authoritative.
 *
 *   DRAFT (built from every stock-tracked variant, unit costs proposed and labelled) ──owner edits──► APPROVED (lines
 *   frozen, fingerprinted) ──post──► POSTED, in ONE transaction:
 *     1. every stock-tracked variant is row-locked (the lock inventory.service's stock updates take);
 *     2. each gets its first valuation entry — a CUTOVER of its physical stock AT POST × the approved unit cost (MISSING
 *        lines are held unvalued, never at zero) — through costing.service, the only valuation writer;
 *        A fill-to-order variant below zero (bottles ordered, not filled) starts with an UNBOOKED deficit at its recipe's
 *        standard cost at the batch's approved material costs (costing.service header; docs/STOCK_HUB.md §3);
 *     3. the inventory account is trued up to `valuation + in-transit − unbooked deficit` (inventoryLedgerBridge) by ONE
 *        adjustment journal:
 *        the difference goes to 5150 Inventory cost adjustments, except the part the owner attributes to a proven
 *        opening-balance error (3900) — locked decision 3;
 *     4. costing is activated (one-way).
 *   A repeat post returns the posted batch. Nothing historical is replayed and no posted journal changes.
 */
import { createHash } from "node:crypto";
import { Prisma, type FinanceValuationStatus, type InventoryCutoverBatch, type InventoryCutoverLine } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { financeTransaction } from "./finance-tx";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { resolveMappedAccount } from "./chart.service";
import { journalDto, postJournalInTx, type JournalLineSpec } from "./journal.service";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { activateInventoryCostingInTx, fillToOrderRecipeLines, recipeStandardCosts, recordValuationsInTx, type ValuationInput } from "./costing.service";
import { COMMERCE_EVENT_TYPES } from "./commerce-posting-rules";

type Db = AppTransactionClient | typeof prisma;

// ── the inventory ledger bridge (one authoritative calculation; the cutover and the valuation-vs-ledger check use it) ──

export interface InventoryLedgerBridge {
  /** Balance of the inventory account (asset.inventory), all posted journals, minor units. */
  ledgerMinor: number;
  /** Σ value of every variant's cost position (the valuation ledger), minor units. */
  valuationMinor: number;
  /** Units out of stock for orders whose cost Phase 3 has not yet taken out of the inventory account (it does at
   * recognition, at the line's own unit cost): Σ (units out × line unit cost) − what Phase 3 already credited per order. */
  inTransitMinor: number;
  inTransit: { unitsOutMinor: number; creditedMinor: number; orders: number };
  /** Inventory-account movement booked at approved ESTIMATES (units with no recorded cost) since `estimatedSince` —
   * the valuation never held those units, so it explains a ledger below the valuation. */
  estimatedSinceMinor: number;
  /** Value of the unbooked deficit layers (fill-to-order bottles sold or ordered before they were filled, at their
   * provisional recipe cost): the order lines carry that cost in in-transit, but the materials that will fill them are
   * still in the valuation — the books hold it once, so it is subtracted (costing.service header). */
  unbookedDeficitMinor: number;
}

/**
 * Orders (alias `o`) the opening inventory count carries: placed before the opening date — their stock already left the
 * shelf — but not yet sold in the books' sense on it (the dashboard's realisation: COD at first delivery, online at the
 * first successful payment). Their units still belong to the business on the opening date, so the count includes them
 * and the sale, posted later, takes their cost out of inventory. Deleted orders are never sold and are not carried.
 */
export function carriedIntoOpeningSql(timezone: string, openingDate: string): Prisma.Sql {
  const opening = dateColumn(openingDate);
  const before = (column: Prisma.Sql) => Prisma.sql`(${column} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::date < ${opening}::date`;
  return Prisma.sql`${before(Prisma.sql`o."createdAt"`)} AND o."deletedAt" IS NULL AND NOT (CASE WHEN o."paymentMethod" = 'COD'
    THEN EXISTS (SELECT 1 FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h.status IN ('DELIVERED', 'PARTIALLY_DELIVERED') AND ${before(Prisma.sql`h."createdAt"`)})
    ELSE EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status = 'SUCCEEDED' AND ${before(Prisma.sql`p."settledAt"`)}) END)`;
}

/**
 * The inventory account against the valuation. Invariant once costing is active:
 *   ledger = valuation + in-transit − estimated-since-activation.
 * In-transit covers orders placed on or after the Financial Opening Date, and earlier orders the opening count carries
 * (see carriedIntoOpeningSql). An order is followed through the journal lines Phase 3 posts with the order as party at
 * KNOWN cost, except damaged-return write-offs (units that came back and left again, not units out to the order).
 */
export async function inventoryLedgerBridge(db: Db, business: Pick<FinanceBusinessInfo, "id" | "baseCurrency" | "timezone" | "openingDate">, opts: { estimatedSince?: Date | null } = {}): Promise<InventoryLedgerBridge> {
  const cur = business.baseCurrency;
  const inventory = await resolveMappedAccount(db, business.id, "asset.inventory");
  const opening = business.openingDate ?? "0001-01-01";
  const [ledger] = await db.$queryRaw<Array<{ d: Prisma.Decimal; c: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND l."accountId" = ${inventory.id}`;
  const [valuation] = await db.$queryRaw<Array<{ v: Prisma.Decimal }>>`SELECT COALESCE(SUM(value), 0) AS v FROM "InventoryCostState" WHERE "businessId" = ${business.id}`;
  const [transit] = await db.$queryRaw<Array<{ out: bigint; credited: Prisma.Decimal; orders: number }>>`
    WITH scope AS (
      SELECT o.id FROM "Order" o
      WHERE (o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${business.timezone})::date >= ${dateColumn(opening)}::date
         OR (${carriedIntoOpeningSql(business.timezone, opening)})
    ),
    u AS (
      SELECT i."orderId", SUM((i.quantity - i."restockedQuantity")::bigint * i."unitCostSnapshot") AS out
      FROM "OrderItem" i JOIN scope s ON s.id = i."orderId"
      WHERE i."unitCostSnapshot" IS NOT NULL
      GROUP BY i."orderId"
    ),
    c AS (
      SELECT l."partyId" AS "orderId", SUM(l.credit - l.debit) AS credited
      FROM "JournalLine" l
      JOIN "JournalEntry" e ON e.id = l."entryId"
      LEFT JOIN "JournalEntry" orig ON orig.id = e."reversesEntryId"
      LEFT JOIN "FinancialEvent" fe ON fe.id = COALESCE(e."financialEventId", orig."financialEventId")
      JOIN scope s ON s.id = l."partyId"
      WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND l."accountId" = ${inventory.id}
        AND l."partyType" = 'Order' AND l."valuationStatus" = 'KNOWN'
        AND fe."eventType" IS DISTINCT FROM ${COMMERCE_EVENT_TYPES.writtenOff}
      GROUP BY l."partyId"
    )
    SELECT COALESCE(SUM(u.out), 0)::bigint AS out, COALESCE(SUM(c.credited), 0) AS credited,
           COUNT(*) FILTER (WHERE COALESCE(u.out, 0) <> 0 OR COALESCE(c.credited, 0) <> 0)::int AS orders
    FROM u FULL OUTER JOIN c ON c."orderId" = u."orderId"`;
  let estimatedSinceMinor = 0;
  if (opts.estimatedSince) {
    // Only commerce's approved estimates (sale lines with no recorded cost, estimated stock write-offs) — units the valuation
    // never held a cost for. A production or purchasing line tagged ESTIMATED moves value the valuation DOES hold.
    const [est] = await db.$queryRaw<Array<{ d: Prisma.Decimal; c: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
      LEFT JOIN "JournalEntry" orig ON orig.id = e."reversesEntryId"
      LEFT JOIN "FinancialEvent" fe ON fe.id = COALESCE(e."financialEventId", orig."financialEventId")
      WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND l."accountId" = ${inventory.id}
        AND l."valuationStatus" = 'ESTIMATED' AND e."postedAt" >= ${opts.estimatedSince}
        AND (fe."eventType" LIKE 'commerce.%' OR fe."eventType" = ${COMMERCE_EVENT_TYPES.stockWriteOff})`;
    estimatedSinceMinor = toMinor(est!.c, cur) - toMinor(est!.d, cur);
  }
  const [unbooked] = await db.$queryRaw<Array<{ v: bigint }>>`
    SELECT COALESCE(SUM((l->>'qty')::bigint * (l->>'unitCostMinor')::bigint), 0)::bigint AS v
    FROM "InventoryCostState" s, jsonb_array_elements(s."deficitLayers") l
    WHERE s."businessId" = ${business.id} AND (l->>'unbooked')::boolean IS TRUE`;
  const unitsOutMinor = Number(transit!.out);
  const creditedMinor = toMinor(transit!.credited, cur);
  return {
    ledgerMinor: toMinor(ledger!.d, cur) - toMinor(ledger!.c, cur),
    valuationMinor: toMinor(valuation!.v, cur),
    inTransitMinor: unitsOutMinor - creditedMinor,
    inTransit: { unitsOutMinor, creditedMinor, orders: transit!.orders },
    estimatedSinceMinor,
    unbookedDeficitMinor: Number(unbooked!.v),
  };
}

// ── DTOs ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CutoverCostSource = "OPENING_COUNT" | "CATALOG_VARIANT" | "CATALOG_PRODUCT" | "OWNER" | "SUPPLIER_INVOICE" | "NONE" | "ADDED_AT_POST";

function lineDto(l: InventoryCutoverLine, cur: string) {
  return {
    id: l.id,
    variantId: l.variantId,
    sku: l.sku,
    name: l.name,
    unitCost: l.unitCost === null ? null : toMajorNumber(toMinor(l.unitCost, cur), cur),
    valuationStatus: l.valuationStatus,
    costSource: l.costSource,
    evidence: l.evidence,
    draftQuantity: l.draftQuantity,
    postedQuantity: l.postedQuantity,
    postedValue: l.postedValue === null ? null : toMajorNumber(toMinor(l.postedValue, cur), cur),
    valuationEntryId: l.valuationEntryId,
  };
}

function batchDto(b: InventoryCutoverBatch, cur: string) {
  return {
    id: b.id,
    status: b.status,
    cutoverDate: businessDateOf(b.cutoverDate),
    notes: b.notes,
    openingErrorAmount: toMajorNumber(toMinor(b.openingErrorAmount, cur), cur),
    openingErrorReason: b.openingErrorReason,
    createdByAdminId: b.createdByAdminId,
    approvedByAdminId: b.approvedByAdminId,
    approvedAt: b.approvedAt,
    postedByAdminId: b.postedByAdminId,
    postedAt: b.postedAt,
    journalEntryId: b.journalEntryId,
    summary: b.summary,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

async function lineSummary(db: Db, batchId: string, cur: string) {
  const groups = await db.inventoryCutoverLine.groupBy({ by: ["valuationStatus"], where: { batchId }, _count: { _all: true }, _sum: { draftQuantity: true } });
  const [valued] = await db.$queryRaw<Array<{ v: Prisma.Decimal | null }>>`
    SELECT SUM(GREATEST("draftQuantity", 0) * "unitCost") AS v FROM "InventoryCutoverLine" WHERE "batchId" = ${batchId} AND "unitCost" IS NOT NULL`;
  const by = (s: FinanceValuationStatus) => groups.find((g) => g.valuationStatus === s);
  return {
    lines: groups.reduce((n, g) => n + g._count._all, 0),
    known: by("KNOWN")?._count._all ?? 0,
    estimated: by("ESTIMATED")?._count._all ?? 0,
    missing: by("MISSING")?._count._all ?? 0,
    missingUnits: by("MISSING")?._sum.draftQuantity ?? 0,
    /** Σ draft quantity × unit cost — the valuation the post would write if no stock moved meanwhile. */
    draftValuation: toMajorNumber(toMinor(valued?.v ?? 0, cur), cur),
  };
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const loadBatch = (db: Db, businessId: string) => db.inventoryCutoverBatch.findUnique({ where: { businessId } });

/** The cutover (or null), its line summary, the costing switch, and — before it is posted — the live ledger bridge and
 * the adjustment the post would book at today's figures. */
export async function getCutover() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const [batch, biz, openingBatch] = await Promise.all([
    loadBatch(prisma, business.id),
    prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } }),
    prisma.openingBalanceBatch.findUnique({ where: { businessId: business.id }, select: { status: true } }),
  ]);
  const prerequisites = {
    openingDateSet: Boolean(business.openingDate),
    openingBalancesPosted: openingBatch?.status === "POSTED",
    costingActive: Boolean(biz.inventoryCostingActivatedAt),
  };
  if (!batch) return { batch: null, summary: null, preview: null, prerequisites, costingActivatedAt: biz.inventoryCostingActivatedAt };
  const summary = await lineSummary(prisma, batch.id, cur);
  let preview = null;
  if (batch.status !== "POSTED") {
    const bridge = await inventoryLedgerBridge(prisma, business);
    const valuation = toMinor(summary.draftValuation, cur);
    const lines = await prisma.inventoryCutoverLine.findMany({ where: { batchId: batch.id }, select: { variantId: true, draftQuantity: true, unitCost: true } });
    const short = await unfilledAtRecipeCost(prisma, lines.map((l) => ({ variantId: l.variantId, qty: l.draftQuantity })), lines, cur);
    const unfilled = [...short.values()].reduce((s, x) => s + x.qty * x.unitMinor, 0);
    const adjustment = valuation + bridge.inTransitMinor - unfilled - bridge.ledgerMinor;
    preview = {
      ledger: toMajorNumber(bridge.ledgerMinor, cur),
      valuation: summary.draftValuation,
      inTransit: toMajorNumber(bridge.inTransitMinor, cur),
      unfilledAtRecipeCost: toMajorNumber(unfilled, cur),
      unfilledUnits: [...short.values()].reduce((s, x) => s + x.qty, 0),
      inTransitOrders: bridge.inTransit.orders,
      adjustment: toMajorNumber(adjustment, cur),
    };
  }
  return { batch: batchDto(batch, cur), summary, preview, prerequisites, costingActivatedAt: biz.inventoryCostingActivatedAt };
}

export async function listCutoverLines(q: { status?: FinanceValuationStatus; search?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const batch = await loadBatch(prisma, business.id);
  if (!batch) throw financeError(404, "CUTOVER_NOT_FOUND", "No valuation cutover has been started");
  const where: Prisma.InventoryCutoverLineWhereInput = {
    batchId: batch.id,
    ...(q.status ? { valuationStatus: q.status } : {}),
    ...(q.search ? { OR: [{ sku: { contains: q.search, mode: "insensitive" } }, { name: { contains: q.search, mode: "insensitive" } }] } : {}),
  };
  const [total, lines] = await Promise.all([
    prisma.inventoryCutoverLine.count({ where }),
    prisma.inventoryCutoverLine.findMany({ where, orderBy: [{ sku: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, lines: lines.map((l) => lineDto(l, business.baseCurrency)) };
}

// ── draft ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface TrackedVariant { id: string; sku: string; name: string; stock: number; variantCost: Prisma.Decimal | null; productCost: Prisma.Decimal | null }

async function trackedVariants(db: Db): Promise<TrackedVariant[]> {
  return db.$queryRaw<TrackedVariant[]>`
    SELECT v.id, v.sku, left(p.name || ' — ' || v.size || ' / ' || v.color, 200) AS name, v.stock,
           v."costPrice" AS "variantCost", p."costPrice" AS "productCost"
    FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
    WHERE p."trackInventory" ORDER BY v.id`;
}

/** The proposed cost of a variant: a KNOWN unit cost from the posted opening count when there is one; otherwise the
 * catalog's typed cost price as an ESTIMATE (it is not backed by a supplier document); otherwise MISSING. */
function proposal(v: TrackedVariant, opening: Map<string, Prisma.Decimal>, cur: string): Pick<InventoryCutoverLine, "unitCost" | "valuationStatus" | "costSource" | "evidence"> {
  const counted = opening.get(v.id);
  if (counted && toMinor(counted, cur) > 0) return { unitCost: counted, valuationStatus: "KNOWN", costSource: "OPENING_COUNT", evidence: "Unit cost from the posted opening inventory count (KNOWN)" };
  const cost = v.variantCost ?? v.productCost;
  if (cost !== null && toMinor(cost, cur) > 0) {
    return { unitCost: cost, valuationStatus: "ESTIMATED", costSource: v.variantCost !== null ? "CATALOG_VARIANT" : "CATALOG_PRODUCT", evidence: "Typed catalog cost price — not purchase-verified" };
  }
  return { unitCost: null, valuationStatus: "MISSING", costSource: "NONE", evidence: null };
}

/**
 * Fill-to-order variants below zero on the cutover (ordered, not filled): units short and the recipe's standard cost at
 * the batch's approved material unit costs (the materials are cut over in the same batch). A variant whose recipe has a
 * material without an approved cost is left out (its deficit starts with no cost, as before).
 */
async function unfilledAtRecipeCost(db: Db, stock: Array<{ variantId: string; qty: number }>, lines: Array<{ variantId: string; unitCost: Prisma.Decimal | null }>, cur: string): Promise<Map<string, { qty: number; unitMinor: number }>> {
  const short = stock.filter((x) => x.qty < 0);
  const out = new Map<string, { qty: number; unitMinor: number }>();
  if (!short.length) return out;
  const recipe = await fillToOrderRecipeLines(db, short.map((x) => x.variantId).sort());
  const cost = new Map(lines.map((l) => [l.variantId, l.unitCost]));
  const unit = recipeStandardCosts(recipe, (id) => cost.get(id) ?? null, cur);
  for (const x of short) {
    const u = unit.get(x.variantId);
    if (u != null) out.set(x.variantId, { qty: -x.qty, unitMinor: u });
  }
  return out;
}

async function lockBatch(tx: AppTransactionClient, businessId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "InventoryCutoverBatch" WHERE "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "CUTOVER_NOT_FOUND", "No valuation cutover has been started");
  return tx.inventoryCutoverBatch.findUniqueOrThrow({ where: { id: rows[0]!.id } });
}

function assertDraft(b: InventoryCutoverBatch) {
  if (b.status === "POSTED") throw financeError(409, "CUTOVER_POSTED", "The valuation cutover is posted and can't change");
  if (b.status !== "DRAFT") throw financeError(409, "CUTOVER_NOT_DRAFT", "Send the cutover back to draft before changing it");
}

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

/**
 * Starts the cutover, or refreshes a draft: one line per stock-tracked variant, with today's stock (information — the
 * post uses the stock at that moment) and a proposed, labelled unit cost. A refresh keeps every cost already entered,
 * adds variants created since and drops variants no longer stock-tracked.
 */
export async function draftCutover(input: { notes?: string | null }, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id } });
    if (biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_ALREADY_ACTIVE", "Inventory costing is already active");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-cutover:${business.id}`}))`;
    let batch = await loadBatch(tx, business.id);
    const refresh = Boolean(batch);
    if (batch) {
      batch = await lockBatch(tx, business.id);
      assertDraft(batch);
      if (input.notes !== undefined) batch = await tx.inventoryCutoverBatch.update({ where: { id: batch.id }, data: { notes: input.notes } });
      else batch = await tx.inventoryCutoverBatch.update({ where: { id: batch.id }, data: { updatedAt: new Date() } });
    } else {
      batch = await tx.inventoryCutoverBatch.create({ data: { businessId: business.id, brandId: brand.id, cutoverDate: dateColumn(businessToday(business)), notes: input.notes ?? null, createdByAdminId: adminOf(actor) } });
    }
    const variants = await trackedVariants(tx);
    const openingItems = await tx.openingInventoryItem.findMany({ where: { batch: { businessId: business.id, status: "POSTED" }, variantId: { not: null }, valuationStatus: "KNOWN" }, select: { variantId: true, unitCost: true } });
    const opening = new Map(openingItems.filter((i) => i.unitCost !== null).map((i) => [i.variantId!, i.unitCost!]));
    const existing = new Map((await tx.inventoryCutoverLine.findMany({ where: { batchId: batch.id } })).map((l) => [l.variantId, l]));
    const tracked = new Set(variants.map((v) => v.id));
    const drop = [...existing.keys()].filter((id) => !tracked.has(id));
    if (drop.length) await tx.inventoryCutoverLine.deleteMany({ where: { batchId: batch.id, variantId: { in: drop } } });
    const fresh = variants.filter((v) => !existing.has(v.id));
    if (fresh.length) {
      await tx.inventoryCutoverLine.createMany({ data: fresh.map((v) => ({ batchId: batch!.id, variantId: v.id, sku: v.sku, name: v.name, draftQuantity: v.stock, ...proposal(v, opening, cur) })) });
    }
    const stale = variants.filter((v) => { const l = existing.get(v.id); return l && (l.draftQuantity !== v.stock || l.sku !== v.sku || l.name !== v.name); });
    if (stale.length) {
      await tx.$executeRaw`
        UPDATE "InventoryCutoverLine" l SET "draftQuantity" = x.qty, sku = x.sku, name = x.name, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
        FROM jsonb_to_recordset(${JSON.stringify(stale.map((v) => ({ id: v.id, qty: v.stock, sku: v.sku, name: v.name })))}::jsonb) AS x(id text, qty int, sku text, name text)
        WHERE l."batchId" = ${batch.id} AND l."variantId" = x.id`;
    }
    const summary = await lineSummary(tx, batch.id, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: refresh ? "cutover.refresh" : "cutover.draft", entityType: "InventoryCutoverBatch", entityId: batch.id, after: { added: fresh.length, dropped: drop.length, requantified: stale.length, summary } });
    return { batch: batchDto(batch, cur), summary };
  }, { timeout: 120_000 });
}

export interface CutoverLineInput {
  variantId: string;
  unitCost: number | null;
  valuationStatus: "KNOWN" | "ESTIMATED" | "MISSING";
  costSource: Exclude<CutoverCostSource, "ADDED_AT_POST">;
  evidence?: string | null;
}

/** Sets the approved cost of some lines (a draft only). KNOWN needs evidence; ESTIMATED needs a cost; MISSING has none. */
export async function updateCutoverLines(lines: CutoverLineInput[], actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  for (const l of lines) {
    if (l.valuationStatus === "MISSING" ? l.unitCost !== null : l.unitCost === null) throw financeError(400, "CUTOVER_LINE_INVALID", `${l.variantId}: a MISSING line has no cost; KNOWN and ESTIMATED lines need one`);
    if (l.unitCost !== null && (!Number.isFinite(l.unitCost) || l.unitCost < 0 || toMajorNumber(toMinor(l.unitCost, cur), cur) !== l.unitCost)) {
      throw financeError(400, "CUTOVER_LINE_INVALID", `${l.variantId}: a unit cost is a non-negative amount in whole minor units`);
    }
    if (l.valuationStatus === "KNOWN" && !l.evidence?.trim()) throw financeError(400, "CUTOVER_EVIDENCE_REQUIRED", `${l.variantId}: a KNOWN cost needs its evidence (invoice, count sheet, …)`);
    if (l.valuationStatus === "MISSING" && l.costSource !== "NONE") throw financeError(400, "CUTOVER_LINE_INVALID", `${l.variantId}: a MISSING line's source is NONE`);
  }
  return financeTransaction(async (tx) => {
    const batch = await lockBatch(tx, business.id);
    assertDraft(batch);
    const before = await tx.inventoryCutoverLine.findMany({ where: { batchId: batch.id, variantId: { in: lines.map((l) => l.variantId) } } });
    const byVariant = new Map(before.map((l) => [l.variantId, l]));
    const unknown = lines.filter((l) => !byVariant.has(l.variantId)).map((l) => l.variantId);
    if (unknown.length) throw financeError(404, "CUTOVER_LINE_NOT_FOUND", `Not on the cutover: ${unknown.slice(0, 5).join(", ")}`, { variantIds: unknown });
    await tx.$executeRaw`
      UPDATE "InventoryCutoverLine" l SET "unitCost" = x."unitCost"::numeric, "valuationStatus" = x.status::"FinanceValuationStatus", "costSource" = x.source, evidence = x.evidence, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
      FROM jsonb_to_recordset(${JSON.stringify(lines.map((l) => ({ id: l.variantId, unitCost: l.unitCost === null ? null : toDecimal(toMinor(l.unitCost, cur), cur).toString(), status: l.valuationStatus, source: l.costSource, evidence: l.evidence?.trim() || null })))}::jsonb)
        AS x(id text, "unitCost" text, status text, source text, evidence text)
      WHERE l."batchId" = ${batch.id} AND l."variantId" = x.id`;
    await tx.inventoryCutoverBatch.update({ where: { id: batch.id }, data: { updatedAt: new Date() } });
    await recordFinanceAudit(tx, {
      businessId: business.id, actor, action: "cutover.update_lines", entityType: "InventoryCutoverBatch", entityId: batch.id,
      before: before.map((l) => ({ variantId: l.variantId, unitCost: l.unitCost, valuationStatus: l.valuationStatus, costSource: l.costSource })),
      after: lines,
    });
    return { updated: lines.length, summary: await lineSummary(tx, batch.id, cur) };
  });
}

/** Notes and the opening-error attribution (a draft only). */
export async function updateCutoverSettings(input: { notes?: string | null; openingErrorAmount?: number; openingErrorReason?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const batch = await lockBatch(tx, business.id);
    assertDraft(batch);
    const amount = input.openingErrorAmount ?? toMajorNumber(toMinor(batch.openingErrorAmount, cur), cur);
    const reason = input.openingErrorReason !== undefined ? input.openingErrorReason?.trim() || null : batch.openingErrorReason;
    if (amount !== 0 && !reason) throw financeError(400, "OPENING_ERROR_REASON_REQUIRED", "Explain the opening-balance error the amount corrects");
    const after = await tx.inventoryCutoverBatch.update({
      where: { id: batch.id },
      data: { notes: input.notes !== undefined ? input.notes : batch.notes, openingErrorAmount: toDecimal(toMinor(amount, cur), cur), openingErrorReason: amount === 0 ? null : reason },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "cutover.update_settings", entityType: "InventoryCutoverBatch", entityId: batch.id, before: batchDto(batch, cur), after: batchDto(after, cur) });
    return batchDto(after, cur);
  });
}

// ── approval ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function fingerprintOf(db: Db, batch: InventoryCutoverBatch): Promise<string> {
  const lines = await db.inventoryCutoverLine.findMany({ where: { batchId: batch.id }, select: { variantId: true, unitCost: true, valuationStatus: true, costSource: true }, orderBy: { variantId: "asc" } });
  const h = createHash("sha256");
  h.update(`opening-error:${batch.openingErrorAmount.toString()}\n`);
  for (const l of lines) h.update(`${l.variantId}|${l.unitCost?.toString() ?? "-"}|${l.valuationStatus}|${l.costSource}\n`);
  return h.digest("hex");
}

async function assertPrerequisites(tx: AppTransactionClient, business: FinanceBusinessInfo) {
  if (!business.openingDate) throw financeError(409, "OPENING_DATE_NOT_SET", "Set the Financial Opening Date first");
  const opening = await tx.openingBalanceBatch.findUnique({ where: { businessId: business.id }, select: { status: true } });
  if (opening?.status !== "POSTED") throw financeError(409, "OPENING_BALANCES_NOT_POSTED", "Post the opening balances first — the cutover trues the inventory account up from them");
  const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id } });
  if (biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_ALREADY_ACTIVE", "Inventory costing is already active");
}

/** Freezes the lines for posting. Lines with no trustworthy cost (MISSING) must be acknowledged: their units will be held
 * unvalued until a receipt establishes a cost. */
export async function approveCutover(input: { acknowledgeMissing: boolean }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const batch = await lockBatch(tx, business.id);
    assertDraft(batch);
    await assertPrerequisites(tx, business);
    const summary = await lineSummary(tx, batch.id, cur);
    if (!summary.lines) throw financeError(409, "CUTOVER_EMPTY", "The cutover has no lines — refresh it");
    if (summary.missing && !input.acknowledgeMissing) {
      throw financeError(409, "CUTOVER_MISSING_UNACKNOWLEDGED", `${summary.missing} variant(s) (${summary.missingUnits} unit(s)) have no cost and will be held unvalued — acknowledge to approve`, { missing: summary.missing, missingUnits: summary.missingUnits });
    }
    const after = await tx.inventoryCutoverBatch.update({ where: { id: batch.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByAdminId: adminOf(actor), approvedFingerprint: await fingerprintOf(tx, batch) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "cutover.approve", entityType: "InventoryCutoverBatch", entityId: batch.id, before: { status: batch.status }, after: { status: after.status, summary, acknowledgeMissing: input.acknowledgeMissing } });
    return { batch: batchDto(after, cur), summary };
  });
}

export async function reopenCutover(input: { reason: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const batch = await lockBatch(tx, business.id);
    if (batch.status !== "APPROVED") throw financeError(409, "CUTOVER_NOT_APPROVED", batch.status === "POSTED" ? "The valuation cutover is posted and can't change" : "The cutover is already a draft");
    const after = await tx.inventoryCutoverBatch.update({ where: { id: batch.id }, data: { status: "DRAFT", approvedAt: null, approvedByAdminId: null, approvedFingerprint: null } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "cutover.reopen", entityType: "InventoryCutoverBatch", entityId: batch.id, reason: input.reason, before: { status: batch.status }, after: { status: after.status } });
    return batchDto(after, cur);
  });
}

// ── post ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Posts the approved cutover (see the file header). Idempotent: a posted cutover is returned as it is (`replayed`).
 * Locks every stock-tracked variant for the duration — checkout on those variants waits for it (a one-time operation;
 * run it off-peak).
 */
export async function postCutover(actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const batch = await lockBatch(tx, business.id);
    if (batch.status === "POSTED") return { ...(await postedResult(tx, batch, cur)), replayed: true };
    if (batch.status !== "APPROVED") throw financeError(409, "CUTOVER_NOT_APPROVED", "Approve the cutover before posting it");
    await assertPrerequisites(tx, business);
    if ((await fingerprintOf(tx, batch)) !== batch.approvedFingerprint) {
      throw financeError(409, "CUTOVER_CHANGED_SINCE_APPROVAL", "The cutover's lines changed since it was approved (a variant was removed) — send it back to draft and approve it again");
    }
    const today = businessToday(business);
    const now = new Date();

    // 1. lock every stock-tracked variant (sorted — the same order inventory.service locks in), read stock under the lock
    const locked = await tx.$queryRaw<Array<{ id: string; stock: number; sku: string; name: string }>>`
      SELECT v.id, v.stock, v.sku, left(p.name || ' — ' || v.size || ' / ' || v.color, 200) AS name
      FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      WHERE p."trackInventory" ORDER BY v.id FOR UPDATE OF v`;
    const stock = new Map(locked.map((v) => [v.id, v]));

    // 2. variants created since the draft get a MISSING line (their units are held unvalued) — every tracked variant enters costing
    const lines = await tx.inventoryCutoverLine.findMany({ where: { batchId: batch.id }, orderBy: { variantId: "asc" } });
    const onBatch = new Set(lines.map((l) => l.variantId));
    const added = locked.filter((v) => !onBatch.has(v.id));
    if (added.length) {
      await tx.inventoryCutoverLine.createMany({ data: added.map((v) => ({ batchId: batch.id, variantId: v.id, sku: v.sku, name: v.name, draftQuantity: v.stock, unitCost: null, valuationStatus: "MISSING" as const, costSource: "ADDED_AT_POST", evidence: "Variant created after the draft — no cost approved" })) });
    }
    const all = added.length ? await tx.inventoryCutoverLine.findMany({ where: { batchId: batch.id }, orderBy: { variantId: "asc" } }) : lines;
    const toCut = all.filter((l) => stock.has(l.variantId)); // a line whose product stopped being stock-tracked is skipped
    const skipped = all.filter((l) => !stock.has(l.variantId)).map((l) => l.variantId);

    // 3. the first valuation entry of each variant, through the one valuation writer (refuses a variant that already has one)
    const unfilled = await unfilledAtRecipeCost(tx, toCut.map((l) => ({ variantId: l.variantId, qty: stock.get(l.variantId)!.stock })), all, cur);
    const inputs: ValuationInput[] = toCut.map((l) => {
      const qty = stock.get(l.variantId)!.stock;
      const unit = l.unitCost === null ? null : toMinor(l.unitCost, cur);
      return {
        business: { id: business.id, baseCurrency: cur },
        brandId: brand.id,
        variantId: l.variantId,
        stockMovementId: null,
        sourceType: "InventoryCutoverBatch",
        sourceId: batch.id,
        financialDate: today,
        note: `Valuation cutover (${l.costSource})`,
        op: { type: "CUTOVER", qty, valueMinor: unit !== null && qty > 0 ? unit * qty : null, status: l.valuationStatus === "KNOWN" ? "KNOWN" : "ESTIMATED", deficitUnitCostMinor: unfilled.get(l.variantId)?.unitMinor ?? null },
      };
    });
    let results: Awaited<ReturnType<typeof recordValuationsInTx>>;
    try {
      results = await recordValuationsInTx(tx, inputs);
    } catch (err) {
      if (err instanceof Error && /first valuation|already has valuation history/.test(err.message)) throw financeError(409, "COSTING_STATE_EXISTS", "Some variants already have valuation history — the cutover is every variant's first entry");
      throw err;
    }
    const posted = toCut.map((l, i) => ({ id: l.id, qty: stock.get(l.variantId)!.stock, value: toDecimal(Number(results[i]!.figures.valueChange), cur).toString(), entryId: results[i]!.entryId }));
    if (posted.length) {
      await tx.$executeRaw`
        UPDATE "InventoryCutoverLine" l SET "postedQuantity" = x.qty, "postedValue" = x.value::numeric, "valuationEntryId" = x."entryId", "updatedAt" = (NOW() AT TIME ZONE 'UTC')
        FROM jsonb_to_recordset(${JSON.stringify(posted)}::jsonb) AS x(id text, qty int, value text, "entryId" text)
        WHERE l.id = x.id`;
    }

    // 4. the ledger true-up: inventory account → valuation + in-transit − unbooked deficit (bottles ordered, not filled: their
    //    cost is in in-transit, their materials in the valuation); the owner's opening-error share → 3900, the rest → 5150
    const bridge = await inventoryLedgerBridge(tx, business);
    const target = bridge.valuationMinor + bridge.inTransitMinor - bridge.unbookedDeficitMinor;
    const adjustment = target - bridge.ledgerMinor;
    const openingError = toMinor(batch.openingErrorAmount, cur);
    if (openingError !== 0 && (Math.sign(openingError) !== Math.sign(adjustment) || Math.abs(openingError) > Math.abs(adjustment))) {
      throw financeError(409, "CUTOVER_OPENING_ERROR_EXCEEDS", `The opening-balance error (${toMajorNumber(openingError, cur)}) must be part of the true-up (${toMajorNumber(adjustment, cur)}) — same sign, no larger`, { adjustment: toMajorNumber(adjustment, cur), openingError: toMajorNumber(openingError, cur) });
    }
    let journal = null;
    if (adjustment !== 0) {
      const [inventory, adjustments, equity] = await Promise.all([
        resolveMappedAccount(tx, business.id, "asset.inventory"),
        resolveMappedAccount(tx, business.id, "cogs.cost_adjustments"),
        resolveMappedAccount(tx, business.id, "equity.opening_balance"),
      ]);
      const side = (amount: number) => (amount > 0 ? { debit: amount, credit: 0 } : { debit: 0, credit: -amount });
      const rest = adjustment - openingError;
      const jl: JournalLineSpec[] = [
        { accountId: inventory.id, ...side(adjustment), brandId: brand.id, memo: `Valuation cutover: inventory account to valuation ${toMajorNumber(bridge.valuationMinor, cur)} + in-transit ${toMajorNumber(bridge.inTransitMinor, cur)}${bridge.unbookedDeficitMinor ? ` − unfilled ${toMajorNumber(bridge.unbookedDeficitMinor, cur)}` : ""}` },
        ...(openingError ? [{ accountId: equity.id, ...side(-openingError), brandId: brand.id, memo: `Proven opening-balance error: ${batch.openingErrorReason}` }] : []),
        ...(rest ? [{ accountId: adjustments.id, ...side(-rest), brandId: brand.id, memo: "Valuation cutover difference (unexplained drift since the opening count)" }] : []),
      ];
      const { entry } = await postJournalInTx(tx, business, {
        entryDate: today,
        description: `Inventory valuation cutover — ${toCut.length} variant(s)`,
        brandId: brand.id,
        kind: "ADJUSTMENT",
        lines: jl,
        sourceType: "InventoryCutoverBatch",
        sourceId: batch.id,
        idempotencyKey: `inventory-cutover:${batch.id}`,
      }, actor);
      journal = entry;
    }

    // 5. costing becomes authoritative (one-way); the batch is final
    await activateInventoryCostingInTx(tx, business.id, now, actor);
    const counts = await lineSummary(tx, batch.id, cur);
    const summary = {
      variants: toCut.length,
      addedAtPost: added.length,
      skippedUntracked: skipped.length,
      known: counts.known,
      estimated: counts.estimated,
      missing: counts.missing,
      unvaluedUnits: results.reduce((n, r) => n + r.position.unvaluedQty, 0),
      deficitUnits: results.reduce((n, r) => n + r.position.deficitQty, 0),
      ledgerBefore: toMajorNumber(bridge.ledgerMinor, cur),
      valuation: toMajorNumber(bridge.valuationMinor, cur),
      inTransit: toMajorNumber(bridge.inTransitMinor, cur),
      inTransitOrders: bridge.inTransit.orders,
      unfilledAtRecipeCost: toMajorNumber(bridge.unbookedDeficitMinor, cur),
      unfilledUnits: [...unfilled.values()].reduce((n, x) => n + x.qty, 0),
      adjustment: toMajorNumber(adjustment, cur),
      toOpeningBalanceEquity: toMajorNumber(openingError, cur),
      toCostAdjustments: toMajorNumber(adjustment - openingError, cur),
      activatedAt: now.toISOString(),
    };
    const after = await tx.inventoryCutoverBatch.update({
      where: { id: batch.id },
      data: { status: "POSTED", cutoverDate: dateColumn(today), postedAt: now, postedByAdminId: adminOf(actor), journalEntryId: journal?.id ?? null, summary },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "cutover.post", entityType: "InventoryCutoverBatch", entityId: batch.id, before: { status: batch.status }, after: { status: after.status, journalEntryId: journal?.id ?? null, summary } });
    return { batch: batchDto(after, cur), journal: journal ? journalDto(journal) : null, replayed: false };
  }, { timeout: 300_000 });
}

async function postedResult(tx: AppTransactionClient, batch: InventoryCutoverBatch, cur: string) {
  const journal = batch.journalEntryId
    ? await tx.journalEntry.findUniqueOrThrow({ where: { id: batch.journalEntryId }, include: { lines: { orderBy: { lineNo: "asc" } }, reversedBy: { select: { id: true, number: true } }, correctedBy: { select: { id: true, number: true } } } })
    : null;
  return { batch: batchDto(batch, cur), journal: journal ? journalDto(journal) : null };
}
