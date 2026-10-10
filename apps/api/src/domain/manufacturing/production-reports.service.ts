/**
 * Production dashboard (docs/MANUFACTURING.md §9): open work in progress, orders by status, overdue orders, producer
 * performance (deliveries on time, yield, rejects, final unit cost) and the cost sheet of recently closed orders — planned
 * against final. Read-only, derived from the orders' own figures; costs only for costing.read.
 */
import { getFinanceContext, businessToday } from "../finance/finance-context";
import { toMajorNumber, toMinor } from "../finance/finance-values";
import { productionOrdersForReport } from "./production-orders.service";

const OPEN = ["APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"];

export async function manufacturingOverview(opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const orders = await productionOrdersForReport(business.id, cur, opts);
  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const open = orders.filter((o) => OPEN.includes(o.status));
  const wipMinor = (o: (typeof orders)[number]) => (o.wip ? toMinor(o.wip.total, cur) : 0);

  const producers = new Map<string, { producer: { id: string; code: string; displayName: string } | null; orders: number; delivered: number; accepted: number; rejected: number; rework: number; datedOrders: number; onTime: number; closed: number; goodsMinor: number; acceptedClosed: number }>();
  for (const o of orders) {
    const key = o.producerSupplierId ?? "in-house";
    const p = producers.get(key) ?? { producer: o.producer ? { id: o.producer.id, code: o.producer.code, displayName: o.producer.displayName } : null, orders: 0, delivered: 0, accepted: 0, rejected: 0, rework: 0, datedOrders: 0, onTime: 0, closed: 0, goodsMinor: 0, acceptedClosed: 0 };
    p.orders += 1;
    p.delivered += o.progress.delivered;
    p.accepted += o.progress.accepted;
    p.rejected += o.progress.rejected;
    p.rework += o.progress.rework;
    if (o.performance.onTime !== null) {
      p.datedOrders += 1;
      if (o.performance.onTime) p.onTime += 1;
    }
    if (o.status === "CLOSED" && o.finalCost) {
      p.closed += 1;
      p.goodsMinor += toMinor(o.finalCost.goods, cur);
      p.acceptedClosed += o.progress.accepted;
    }
    producers.set(key, p);
  }
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 10_000) / 100 : null);

  return {
    asOf: today,
    canSeeCost: opts.canSeeCost,
    byStatus,
    openOrders: open.length,
    openWip: opts.canSeeCost ? toMajorNumber(open.reduce((s, o) => s + wipMinor(o), 0), cur) : null,
    open: open.slice(0, 50).map((o) => ({
      id: o.id, number: o.number, status: o.status, product: o.product, producer: o.producer, expectedDate: o.expectedDate,
      overdue: Boolean(o.expectedDate && o.expectedDate < today && o.progress.outstanding > 0),
      planned: o.progress.planned, accepted: o.progress.accepted, outstanding: o.progress.outstanding,
      wip: o.wip ? o.wip.total : null,
      readyToClose: o.status !== "APPROVED" && !o.closeChecklist.materialsAtProducer.length && !o.closeChecklist.draftCosts && !o.closeChecklist.draftReceipts,
    })),
    producers: [...producers.values()]
      .sort((a, b) => b.orders - a.orders)
      .map((p) => ({
        producer: p.producer, orders: p.orders, delivered: p.delivered, accepted: p.accepted,
        yieldPct: pct(p.accepted, p.delivered), rejectionPct: pct(p.rejected, p.delivered), reworkPct: pct(p.rework, p.delivered),
        onTimePct: pct(p.onTime, p.datedOrders), closedOrders: p.closed,
        finalUnitCost: opts.canSeeCost && p.acceptedClosed ? toMajorNumber(Math.round(p.goodsMinor / p.acceptedClosed), cur) : null,
      })),
    closed: orders
      .filter((o) => o.status === "CLOSED")
      .slice(0, 20)
      .map((o) => ({
        id: o.id, number: o.number, product: o.product, producer: o.producer, closedAt: o.closedAt, accepted: o.progress.accepted,
        yieldPct: o.performance.yieldPct, rejectionPct: o.performance.rejectionPct,
        // an incomplete plan (a material with no known cost) has no comparable planned unit cost
        plannedPerUnit: o.planned && !o.planned.materialsWithoutCost ? o.planned.costPerUnit : null,
        finalPerUnit: o.finalCost?.perAcceptedUnit ?? null,
        plannedTotal: o.comparison?.total.planned ?? null,
        finalTotal: o.finalCost?.total ?? null,
        abnormalLoss: o.finalCost?.abnormalLoss ?? null,
      })),
  };
}
