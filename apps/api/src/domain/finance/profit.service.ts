/**
 * Profit views (docs/FINANCE_OWNER_BOOKS.md §8). Contribution of an order = what it sold − its cost of goods − its
 * packaging − its courier charge (estimate until the payout, then actual) − its gateway fee − its share of the period's ad
 * spend (by sales). Read from the books: every figure is posted journal lines with the order as party, the order's
 * settlement-line charges and the valuation of the packaging that left with it. The period's other operating costs (rent,
 * salaries, hosting …) come from the income statement, so the page ends at the same net profit as the books.
 *
 * The launch report (§9) covers the weeks BEFORE the books started: an estimate from the orders, the catalog's cost
 * prices, the courier rate card and the recorded ad spend — clearly labelled, never posted.
 */
import { Prisma, type LedgerAccountType } from "@prisma/client";
import { addDays, businessDate } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "./finance-context";
import { dateColumn, financeError, toMajorNumber, toMinor, type FinanceViewer } from "./finance-values";
import { incomeStatement } from "./statements.service";
import { courierChargeEstimate, courierOutcome } from "./charge-estimates";
import { loadRateCards } from "./charge-projection";
import { plannedSpend } from "./ads.service";
import { unpaidDeliveredCod } from "./courier-payouts.service";

const signed = (v: Prisma.Decimal | null, cur: string) => (v === null ? 0 : v.isNegative() ? -toMinor(v.abs(), cur) : toMinor(v, cur));

interface OrderRow {
  orderId: string;
  orderNumber: string;
  date: string;
  sales: number;
  cogs: number;
  packaging: number;
  courier: number;
  gateway: number;
  ads: number;
  contribution: number;
}

/** Per-order and per-product contribution for a period, and the bridge down to net profit. */
export async function profitReport(q: { from?: string; to?: string }, viewer: FinanceViewer) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const to = q.to ?? businessToday(business);
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw financeError(400, "PERIOD_RANGE", "The period starts before it ends");
  // Every revenue reduction an order can carry (refunds, returns, returns settled in store credit) and every cost booked
  // against it — goods, damaged returns written off (net of courier claims), packaging, courier, gateway.
  const SALES_KEYS = ["revenue.merchandise", "revenue.shipping", "revenue.price_adjustments", "revenue.returns_refunds", "revenue.other_refunds", "revenue.store_credit_returns"];
  const keys = [...SALES_KEYS, "cogs.goods", "cogs.inventory_shrinkage", "expense.courier_fees", "expense.gateway_fees", "expense.advertising", "cogs.packaging"];
  const maps = await prisma.accountMapping.findMany({ where: { businessId: business.id, key: { in: keys } } });
  const accountKey = new Map(maps.map((m) => [m.accountId, m.key]));
  // Order-party lines of the period on the accounts above (Σ credit − debit for revenue, debit − credit for costs).
  const rows = await prisma.$queryRaw<Array<{ partyId: string; accountId: string; net: Prisma.Decimal }>>`
    SELECT l."partyId", l."accountId", COALESCE(SUM(l.debit - l.credit), 0) AS net
    FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND l."partyType" = 'Order'
      AND e."entryDate" >= ${new Date(`${from}T00:00:00Z`)}::date AND e."entryDate" <= ${new Date(`${to}T00:00:00Z`)}::date
      AND l."accountId" IN (${Prisma.join(maps.length ? maps.map((m) => m.accountId) : ["-"])})
    GROUP BY l."partyId", l."accountId"`;
  const byOrder = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const k = accountKey.get(r.accountId)!;
    const o = byOrder.get(r.partyId) ?? {};
    o[k] = (o[k] ?? 0) + signed(r.net, cur);
    byOrder.set(r.partyId, o);
  }
  // Actual courier / gateway charges a posted settlement booked for the order (the settlement's fee line has no party).
  const fees = await prisma.clearingSettlementLine.findMany({
    where: { orderId: { not: null }, settlement: { businessId: business.id, status: "POSTED", settlementDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } },
    select: { orderId: true, fee: true, settlement: { select: { clearingAccount: { select: { kind: true } } } } },
  });
  for (const f of fees) {
    const o = byOrder.get(f.orderId!) ?? {};
    const k = f.settlement.clearingAccount.kind === "COURIER" ? "expense.courier_fees" : "expense.gateway_fees";
    o[k] = (o[k] ?? 0) + toMinor(f.fee, cur);
    byOrder.set(f.orderId!, o);
  }
  // Packaging that left with each parcel in the period, at its valuation.
  const packaging = await prisma.stockMovement.findMany({
    where: { reason: "PACKAGING_USE", sourceType: "OrderPackaging", createdAt: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`), lte: new Date(`${addDays(to, 1)}T23:59:59Z`) } },
    select: { sourceId: true, createdAt: true, valuationEntry: { select: { valueChange: true } } },
  });
  for (const p of packaging) {
    const d = businessDate(p.createdAt, business.timezone);
    if (d < from || d > to || !p.sourceId) continue;
    const o = byOrder.get(p.sourceId) ?? {};
    o["cogs.packaging"] = (o["cogs.packaging"] ?? 0) - signed(p.valuationEntry?.valueChange ?? null, cur);
    byOrder.set(p.sourceId, o);
  }
  const orders = await prisma.order.findMany({ where: { id: { in: [...byOrder.keys()] } }, select: { id: true, orderNumber: true, createdAt: true, items: { select: { variantId: true, productNameSnapshot: true, quantity: true, priceSnapshot: true } } } });
  const ordersById = new Map(orders.map((o) => [o.id, o]));

  // Ad spend of the period (from the books), shared over orders by sales.
  const adsAccount = maps.find((m) => m.key === "expense.advertising");
  const adSpend = adsAccount ? await sumAccount(business.id, adsAccount.accountId, from, to, cur) : 0;
  const outsideMap = await prisma.accountMapping.findFirst({ where: { businessId: business.id, key: "revenue.outside_sales" } });
  const outsideSales = outsideMap ? -(await sumAccount(business.id, outsideMap.accountId, from, to, cur)) : 0;
  // Their goods, at the owner's cost percent (booked with each payout; a reversed payout takes it back).
  const sentOutside = await prisma.accountMapping.findFirst({ where: { businessId: business.id, key: "asset.inventory_sent_outside" } });
  const [outsideCostRow] = sentOutside
    ? await prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>`
        SELECT COALESCE(SUM(l.credit - l.debit), 0) AS net FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" LEFT JOIN "JournalEntry" o ON o.id = e."reversesEntryId"
        WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND l."accountId" = ${sentOutside.accountId} AND COALESCE(o."sourceType", e."sourceType") = 'ClearingSettlement'
          AND e."entryDate" >= ${new Date(`${from}T00:00:00Z`)}::date AND e."entryDate" <= ${new Date(`${to}T00:00:00Z`)}::date`
    : [];
  const outsideSalesCost = signed(outsideCostRow?.net ?? null, cur);
  const { outsideSaleCostPct } = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { outsideSaleCostPct: true } });
  const lines: OrderRow[] = [];
  for (const [orderId, a] of byOrder) {
    const o = ordersById.get(orderId);
    if (!o) continue;
    const sales = -SALES_KEYS.reduce((s, k) => s + (a[k] ?? 0), 0);
    lines.push({ orderId, orderNumber: o.orderNumber, date: businessDate(o.createdAt, business.timezone), sales, cogs: (a["cogs.goods"] ?? 0) + (a["cogs.inventory_shrinkage"] ?? 0), packaging: a["cogs.packaging"] ?? 0, courier: a["expense.courier_fees"] ?? 0, gateway: a["expense.gateway_fees"] ?? 0, ads: 0, contribution: 0 });
  }
  const totalSales = lines.reduce((s, l) => s + Math.max(0, l.sales), 0);
  let given = 0;
  const positive = lines.filter((l) => l.sales > 0);
  positive.forEach((l, i) => {
    l.ads = i === positive.length - 1 ? adSpend - given : totalSales ? Math.round((adSpend * l.sales) / totalSales) : 0;
    given += l.ads;
  });
  for (const l of lines) l.contribution = l.sales - l.cogs - l.packaging - l.courier - l.gateway - l.ads;

  // Per product: each order's figures shared over its lines by line value — by name (as sold) and, for planned vs actual
  // (docs/COST_SHEET.md §5), by size with each cost kept apart.
  const products = new Map<string, { name: string; units: number; sales: number; costs: number; contribution: number }>();
  const sizes = new Map<string, { variantId: string; units: number; sales: number; cogs: number; packaging: number; courier: number; gateway: number; ads: number; contribution: number }>();
  for (const l of lines) {
    const o = ordersById.get(l.orderId)!;
    const value = o.items.reduce((s, it) => s + toMinor(it.priceSnapshot, cur) * it.quantity, 0);
    for (const it of o.items) {
      const share = value ? (toMinor(it.priceSnapshot, cur) * it.quantity) / value : 1 / o.items.length;
      const p = products.get(it.productNameSnapshot) ?? { name: it.productNameSnapshot, units: 0, sales: 0, costs: 0, contribution: 0 };
      p.units += it.quantity;
      p.sales += Math.round(l.sales * share);
      p.costs += Math.round((l.cogs + l.packaging + l.courier + l.gateway + l.ads) * share);
      p.contribution += Math.round(l.contribution * share);
      products.set(it.productNameSnapshot, p);
      if (it.variantId) {
        const z = sizes.get(it.variantId) ?? { variantId: it.variantId, units: 0, sales: 0, cogs: 0, packaging: 0, courier: 0, gateway: 0, ads: 0, contribution: 0 };
        z.units += it.quantity;
        for (const k of ["sales", "cogs", "packaging", "courier", "gateway", "ads", "contribution"] as const) z[k] += Math.round(l[k] * share);
        sizes.set(it.variantId, z);
      }
    }
  }
  const sum = (k: keyof OrderRow) => lines.reduce((s, l) => s + (l[k] as number), 0);
  const income = await incomeStatement({ from, to }, viewer);
  const m = (v: number) => toMajorNumber(v, cur);
  const contribution = sum("contribution");
  const net = income.current.netProfit;
  return {
    period: { from, to },
    totals: {
      orders: lines.length, sales: m(sum("sales")), cogs: m(sum("cogs")), packaging: m(sum("packaging")), courier: m(sum("courier")), gateway: m(sum("gateway")), ads: m(adSpend),
      contribution: m(contribution), contributionPct: sum("sales") ? Math.round((contribution / sum("sales")) * 10_000) / 100 : null,
      /** Parcels sold straight through the courier, never orders on the site. */
      outsideSales: m(outsideSales),
      /** Their estimated cost of goods (Finance Center › Settings percent); null percent = not set, so none was booked. */
      outsideSalesCost: m(outsideSalesCost),
      outsideSaleCostPct: outsideSaleCostPct === null ? null : Number(outsideSaleCostPct),
      /** Everything else the books carry for the period (rent, salaries, hosting, cash over/short, …) — so contribution + outside sales − their cost − this = net profit. */
      otherCosts: Math.round((m(contribution + outsideSales - outsideSalesCost) - net) * 100) / 100,
      netProfit: net,
    },
    orders: lines.sort((a, b) => a.contribution - b.contribution).map((l) => ({ ...l, sales: m(l.sales), cogs: m(l.cogs), packaging: m(l.packaging), courier: m(l.courier), gateway: m(l.gateway), ads: m(l.ads), contribution: m(l.contribution) })),
    /** Per size (variant), each cost apart — what planned vs actual reads. */
    sizes: [...sizes.values()].map((z) => ({ ...z, sales: m(z.sales), cogs: m(z.cogs), packaging: m(z.packaging), courier: m(z.courier), gateway: m(z.gateway), ads: m(z.ads), contribution: m(z.contribution) })),
    products: [...products.values()].sort((a, b) => b.contribution - a.contribution).map((p) => ({ ...p, sales: m(p.sales), costs: m(p.costs), contribution: m(p.contribution), marginPct: p.sales ? Math.round((p.contribution / p.sales) * 10_000) / 100 : null })),
  };
}

/** The longest range profit by day answers — a year and a day. */
const MAX_DAYS = 366;

type DayFigures = { orders: number; sales: number; goods: number; packaging: number; delivery: number; paymentFees: number; ads: number; running: number };
const emptyDay = (): DayFigures => ({ orders: 0, sales: 0, goods: 0, packaging: 0, delivery: 0, paymentFees: 0, ads: 0, running: 0 });

/**
 * Profit by day (docs/FINANCE_PROFIT_DASHBOARD.md): each business day's posted income-statement lines folded into the
 * owner's words — sales, then what the goods, packaging, delivery, payment fees, ads and running costs (rent, salaries,
 * hosting, other income and expenses) took. Every P&L account lands in exactly one bucket, so the days add up to the
 * income statement's net profit for the range. The prior period (same length, just before) comes alongside as totals.
 */
export async function profitByDay(q: { from?: string; to?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -29);
  if (from > to) throw financeError(400, "PERIOD_RANGE", "The period starts before it ends");
  const len = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  if (len + 1 > MAX_DAYS) throw financeError(400, "PERIOD_TOO_LONG", `Profit by day covers at most ${MAX_DAYS} days`);
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(priorTo, -len);

  const maps = await prisma.accountMapping.findMany({ where: { businessId: business.id }, select: { key: true, accountId: true } });
  const keyOf = new Map(maps.map((x) => [x.accountId, x.key]));
  const merchandise = maps.find((x) => x.key === "revenue.merchandise")?.accountId ?? "-";
  const range = Prisma.sql`e."businessId" = ${business.id} AND e.status = 'POSTED' AND e."entryDate" >= ${dateColumn(priorFrom)}::date AND e."entryDate" <= ${dateColumn(to)}::date`;
  const [rows, sold] = await Promise.all([
    prisma.$queryRaw<Array<{ day: string; accountId: string; type: LedgerAccountType; debit: Prisma.Decimal; credit: Prisma.Decimal }>>`
      SELECT to_char(e."entryDate", 'YYYY-MM-DD') AS day, l."accountId", a.type, SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "LedgerAccount" a ON a.id = l."accountId"
      WHERE ${range} AND a.type IN ('REVENUE', 'COGS', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE')
      GROUP BY 1, 2, 3`,
    // Orders whose sale the books took that day (delivered, or paid in full) — not orders placed.
    prisma.$queryRaw<Array<{ day: string; orders: bigint }>>`
      SELECT to_char(e."entryDate", 'YYYY-MM-DD') AS day, COUNT(DISTINCT l."partyId") AS orders
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
      WHERE ${range} AND l."accountId" = ${merchandise} AND l."partyType" = 'Order' AND l.credit > 0
      GROUP BY 1`,
  ]);

  const days = new Map<string, DayFigures>();
  const dayOf = (d: string) => days.get(d) ?? days.set(d, emptyDay()).get(d)!;
  for (const r of rows) {
    const d = dayOf(r.day);
    const cost = toMinor(r.debit, cur) - toMinor(r.credit, cur); // debit nature; revenue and other income are negative costs
    const key = keyOf.get(r.accountId);
    if (r.type === "REVENUE") d.sales -= cost;
    else if (r.type === "COGS" && key === "cogs.packaging") d.packaging += cost;
    else if (r.type === "COGS") d.goods += cost;
    else if (key === "expense.courier_fees" || key === "expense.freight_in") d.delivery += cost;
    else if (key === "expense.gateway_fees") d.paymentFees += cost;
    else if (key === "expense.advertising") d.ads += cost;
    else d.running += cost; // every other expense, other expenses, and other income (as a negative cost)
  }
  for (const r of sold) dayOf(r.day).orders = Number(r.orders);

  const profitOf = (f: DayFigures) => f.sales - f.goods - f.packaging - f.delivery - f.paymentFees - f.ads - f.running;
  const m = (v: number) => toMajorNumber(v, cur);
  const major = (f: DayFigures) => ({ orders: f.orders, sales: m(f.sales), goods: m(f.goods), packaging: m(f.packaging), delivery: m(f.delivery), paymentFees: m(f.paymentFees), ads: m(f.ads), running: m(f.running), profit: m(profitOf(f)) });
  const total = (start: string, end: string) => {
    const t = emptyDay();
    for (const [d, f] of days) if (d >= start && d <= end) for (const k of Object.keys(t) as Array<keyof DayFigures>) t[k] += f[k];
    const profit = profitOf(t);
    return { ...major(t), marginPct: t.sales > 0 ? Math.round((profit / t.sales) * 1000) / 10 : null, salesPerAdTaka: t.ads > 0 ? Math.round((t.sales / t.ads) * 100) / 100 : null };
  };
  const series = [];
  for (let d = from; d <= to; d = addDays(d, 1)) series.push({ date: d, ...major(days.get(d) ?? emptyDay()) });

  return {
    currency: cur,
    today,
    booksStartedOn: business.openingDate,
    period: { from, to },
    prior: { from: priorFrom, to: priorTo },
    days: series,
    totals: total(from, to),
    priorTotals: total(priorFrom, priorTo),
  };
}

async function sumAccount(businessId: string, accountId: string, from: string, to: string, cur: string) {
  const [r] = await prisma.$queryRaw<Array<{ net: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND l."accountId" = ${accountId}
      AND e."entryDate" >= ${new Date(`${from}T00:00:00Z`)}::date AND e."entryDate" <= ${new Date(`${to}T00:00:00Z`)}::date`;
  return signed(r?.net ?? null, cur);
}

/**
 * The weeks before the books started — an ESTIMATE, never posted: delivered sales from the orders, cost of goods at the
 * order line's recorded cost (else the catalog's cost price today), the courier charge from the rate card, and the ad
 * spend recorded for those days (actual, else budget). Lines without a known cost are counted and named.
 */
export async function launchReport(q: { from?: string; to?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const to = q.to ?? (business.openingDate ? addDays(business.openingDate, -1) : businessToday(business));
  const first = await prisma.order.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const from = q.from ?? (first ? businessDate(first.createdAt, business.timezone) : to);
  if (from > to) {
    if (q.from && q.to) throw financeError(400, "PERIOD_RANGE", "The period starts before it ends");
    // The books open before the first order: there were no weeks before the books, so there is nothing to estimate.
    return { period: null, estimate: true as const, orders: { delivered: 0, returned: 0 }, sales: 0, cogs: 0, courier: 0, ads: 0, contribution: 0, courierRateCard: false, missingCost: [] };
  }
  const tz = business.timezone;
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED"] }, createdAt: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`), lte: new Date(`${addDays(to, 1)}T23:59:59Z`) } },
    select: { id: true, status: true, total: true, shippingFee: true, createdAt: true, courierConsignmentId: true, courierStatus: true, shippingDistrict: true, shippingArea: true, items: { select: { variantId: true, quantity: true, returnedQuantity: true, productNameSnapshot: true } }, payments: { where: { status: "SUCCEEDED" }, select: { provider: true, amount: true } } },
  });
  const inRange = orders.filter((o) => {
    const d = businessDate(o.createdAt, tz);
    return d >= from && d <= to;
  });
  const variants = await prisma.productVariant.findMany({ where: { id: { in: [...new Set(inRange.flatMap((o) => o.items.map((i) => i.variantId)))] } }, select: { id: true, costPrice: true, product: { select: { costPrice: true } } } });
  const cost = new Map(variants.map((v) => [v.id, toMinor(v.costPrice ?? v.product.costPrice ?? 0, cur)]));
  // An estimate of weeks before any card was made: the earliest card stands in for them (rates rarely change).
  const loaded = (await loadRateCards(business.id, cur)).cards;
  const earliest = [...loaded].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  const cards = earliest ? [...loaded, { ...earliest, id: `${earliest.id}:backdated`, effectiveFrom: "0000-01-01" }] : loaded;
  let sales = 0, cogs = 0, courier = 0, delivered = 0, returned = 0;
  const missingCost = new Map<string, number>();
  for (const o of inRange) {
    const outcome = courierOutcome(o.courierStatus, o.status);
    if (o.status === "DELIVERED" || o.status === "PARTIALLY_DELIVERED") {
      delivered += 1;
      const collected = o.payments.reduce((s, p) => s + toMinor(p.amount, cur), 0);
      sales += o.status === "DELIVERED" ? toMinor(o.total, cur) : collected;
      for (const it of o.items) {
        const units = it.quantity - (it.returnedQuantity ?? 0);
        const c = cost.get(it.variantId) ?? 0;
        if (!c) missingCost.set(it.productNameSnapshot, (missingCost.get(it.productNameSnapshot) ?? 0) + units);
        cogs += c * units;
      }
    } else if (o.courierConsignmentId) returned += 1;
    if (o.courierConsignmentId && outcome) {
      const e = courierChargeEstimate({ outcome, collected: outcome === "RETURNED" ? 0 : o.payments.filter((p) => p.provider === "COD").reduce((s, p) => s + toMinor(p.amount, cur), 0), district: o.shippingDistrict, area: o.shippingArea, date: businessDate(o.createdAt, tz), cards });
      courier += e?.total ?? 0;
    }
  }
  // Ad spend recorded for the days (actual, else the campaign's budget).
  const campaigns = await prisma.adCampaign.findMany({ where: { businessId: business.id }, include: { spendDays: true } });
  let ads = 0;
  for (const c of campaigns) {
    const actual = new Map(c.spendDays.map((d) => [d.date.toISOString().slice(0, 10), toMinor(d.amount, cur)]));
    const planned = plannedSpend({ startDate: c.startDate.toISOString().slice(0, 10), endDate: c.endDate ? c.endDate.toISOString().slice(0, 10) : null, budgetType: c.budgetType, budget: c.budget ? toMinor(c.budget, cur) : null }, to);
    for (const d of new Set([...actual.keys(), ...planned.keys()])) if (d >= from && d <= to) ads += actual.get(d) ?? planned.get(d) ?? 0;
  }
  const m = (v: number) => toMajorNumber(v, cur);
  return {
    period: { from, to },
    estimate: true,
    orders: { delivered, returned },
    sales: m(sales), cogs: m(cogs), courier: m(courier), ads: m(ads),
    contribution: m(sales - cogs - courier - ads),
    courierRateCard: cards.length > 0,
    missingCost: [...missingCost].map(([name, units]) => ({ name, units })),
  };
}

/**
 * Profit month by month since the books started (docs/FINANCE_PROFIT_DASHBOARD.md §5): the same buckets as profit by day,
 * folded per month — so the months add up to the income statement — plus, for each month, how sure the figure is: the
 * share of the goods cost that is still an estimate (or has no cost), the open finance exceptions of its orders, the COD
 * parcels delivered then that no courier payout covers yet, and whether the month is closed. A month with nothing left
 * to settle is ready to close.
 */
export async function profitByMonth() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const start = business.openingDate ?? `${today.slice(0, 7)}-01`;
  const months: string[] = [];
  for (let m = start.slice(0, 7); m <= today.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) months.push(m);
  // profit by day in windows of at most a year, folded per month
  const sums = new Map<string, Record<string, number>>();
  for (let from = start; from <= today; ) {
    const to = addDays(from, MAX_DAYS - 1) < today ? addDays(from, MAX_DAYS - 1) : today;
    const r = await profitByDay({ from, to });
    for (const d of r.days) {
      const k = d.date.slice(0, 7);
      const t = sums.get(k) ?? sums.set(k, { orders: 0, sales: 0, goods: 0, packaging: 0, delivery: 0, paymentFees: 0, ads: 0, running: 0, profit: 0 }).get(k)!;
      for (const f of Object.keys(t)) t[f] = Math.round((t[f]! + Number((d as unknown as Record<string, number>)[f] ?? 0)) * 100) / 100;
    }
    from = addDays(to, 1);
  }
  const [estimated, exceptions, periods, unpaid] = await Promise.all([
    prisma.$queryRaw<Array<{ m: string; status: string | null; net: Prisma.Decimal }>>`
      SELECT to_char(e."entryDate", 'YYYY-MM') AS m, l."valuationStatus"::text AS status, SUM(l.debit - l.credit) AS net
      FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "LedgerAccount" a ON a.id = l."accountId"
      WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND a.type = 'COGS'
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ m: string; n: bigint }>>`
      SELECT to_char(COALESCE(o."createdAt", x."createdAt") AT TIME ZONE ${business.timezone}, 'YYYY-MM') AS m, COUNT(*) AS n
      FROM "FinanceException" x LEFT JOIN "Order" o ON o.id = x."orderId"
      WHERE x."businessId" = ${business.id} AND x.status = 'OPEN' GROUP BY 1`,
    prisma.financialPeriod.findMany({ where: { businessId: business.id }, select: { startDate: true, status: true } }),
    unpaidDeliveredCod({ id: business.id, openingDate: business.openingDate }, 7, 5000),
  ]);
  const unpaidByMonth = new Map<string, { n: number; amount: number }>();
  for (const o of unpaid.orders) {
    const k = businessDate(o.updatedAt, business.timezone).slice(0, 7);
    const u = unpaidByMonth.get(k) ?? { n: 0, amount: 0 };
    u.n += 1;
    u.amount += toMinor(o.total, cur);
    unpaidByMonth.set(k, u);
  }
  const m = (v: number) => toMajorNumber(v, cur);
  return {
    currency: cur,
    booksStartedOn: business.openingDate,
    months: months.map((k) => {
      const t = sums.get(k) ?? { orders: 0, sales: 0, goods: 0, packaging: 0, delivery: 0, paymentFees: 0, ads: 0, running: 0, profit: 0 };
      const cogs = estimated.filter((r) => r.m === k);
      const all = cogs.reduce((s, r) => s + toMinor(r.net, cur), 0);
      const unsure = cogs.filter((r) => r.status === "ESTIMATED" || r.status === "MISSING").reduce((s, r) => s + toMinor(r.net, cur), 0);
      const open = Number(exceptions.find((x) => x.m === k)?.n ?? 0);
      const u = unpaidByMonth.get(k) ?? { n: 0, amount: 0 };
      const period = periods.find((p) => p.startDate.toISOString().slice(0, 7) === k);
      return {
        month: k,
        ...t,
        marginPct: (t.sales ?? 0) > 0 ? Math.round(((t.profit ?? 0) / t.sales!) * 1000) / 10 : null,
        /** Share of the goods cost booked as an estimate (or with no cost). */
        estimatedCostPct: all > 0 ? Math.round((unsure / all) * 1000) / 10 : null,
        openExceptions: open,
        unpaidByCourier: { parcels: u.n, amount: m(u.amount) },
        status: period?.status ?? "OPEN",
        readyToClose: (period?.status ?? "OPEN") !== "CLOSED" && k < today.slice(0, 7) && open === 0 && u.n === 0 && (all === 0 || unsure === 0),
      };
    }),
  };
}
