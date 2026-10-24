/**
 * What happened to the stock, newest first (docs/STOCK_HUB.md §7) — the stock page's activity panel. One event per thing
 * someone did, with the items it touched and their pictures:
 *
 *   BOUGHT        a purchase (Received goods): its lines, supplier, total; incomplete until every step ran
 *   FILLED        bottles filled by hand (Filled bottles / Mark filled)
 *   AUTO_FILLED   bottles recorded as filled when their parcel was booked
 *   COUNTED       a count: what differed (or that everything matched); losses waiting for the owner say so
 *   APPROVED / REJECTED   the owner's decision on a waiting loss
 *   FILL_PROBLEM  a booked parcel's bottles that couldn't be recorded as filled
 *
 * Read only, from the stock hub's own records (entries, approvals, auto-fill failures). `today` counts what was done on
 * the business's today, for the page's "done today" line.
 */
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { imagesFor } from "./stock-images";
import { itemLabel } from "./stock-items.service";

export type StockEventKind = "BOUGHT" | "FILLED" | "AUTO_FILLED" | "COUNTED" | "APPROVED" | "REJECTED" | "FILL_PROBLEM";

export interface StockEventItem {
  variantId: string;
  name: string;
  imageUrl: string | null;
  /** The change to stock this event made (or would make, for a loss waiting); null when it isn't a quantity. */
  change: number | null;
  unit: string;
}

export interface StockEvent {
  id: string;
  kind: StockEventKind;
  at: Date;
  by: string | null;
  items: StockEventItem[];
  /** BOUGHT: supplier; COUNTED: how many items were counted; FILL_PROBLEM: order number. */
  context: string | null;
  /** Money (BOUGHT total, a decided loss) — only with costing.read. */
  value: number | null;
  /** BOUGHT that stopped part way; COUNTED with losses waiting for the owner. */
  pending: boolean;
  note: string | null;
}

export const ACTIVITY_MAX = 100;

interface CountLineStep { variantId: string; name: string; unit: string; counted: number; expected?: number; difference?: number; pendingApprovalId?: string | null; done?: boolean }

export async function stockActivity(q: { limit?: number }, viewer: { canSeeCost: boolean }) {
  const limit = Math.min(ACTIVITY_MAX, Math.max(1, q.limit ?? 30));
  const { business } = await getFinanceContext();
  const [entries, decided, problems] = await Promise.all([
    prisma.stockHubEntry.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, kind: true, steps: true, createdAt: true, completedAt: true, createdByAdminId: true } }),
    prisma.stockCountApproval.findMany({ where: { businessId: business.id, status: { in: ["APPROVED", "REJECTED"] } }, orderBy: { decidedAt: "desc" }, take: limit, select: { id: true, status: true, variantId: true, difference: true, value: true, decidedAt: true, decidedByAdminId: true, decisionNote: true } }),
    prisma.stockAutoFillFailure.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, variantId: true, units: true, reason: true, createdAt: true, resolvedAt: true, order: { select: { orderNumber: true } } } }),
  ]);

  // the variants every event names, for their labels, units and pictures
  const variantIds = new Set<string>();
  for (const e of entries) {
    const s = e.steps as Record<string, unknown>;
    if (e.kind === "PURCHASE") for (const l of ((s.request as { lines?: Array<{ variantId: string }> })?.lines ?? [])) variantIds.add(l.variantId);
    if (e.kind === "FILL") { const v = (s.request as { variantId?: string })?.variantId; if (v) variantIds.add(v); }
    if (e.kind === "COUNT") for (const l of ((s.lines as CountLineStep[]) ?? [])) variantIds.add(l.variantId);
  }
  for (const a of decided) variantIds.add(a.variantId);
  for (const p of problems) variantIds.add(p.variantId);
  const ids = [...variantIds];
  const [variants, images] = await Promise.all([
    prisma.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, size: true, color: true, product: { select: { name: true, kind: true, stockUnit: true } } } }),
    imagesFor(ids),
  ]);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const item = (variantId: string, change: number | null): StockEventItem => {
    const v = vById.get(variantId);
    const material = v?.product.kind === "MATERIAL";
    return {
      variantId,
      name: v ? itemLabel({ productName: v.product.name, size: v.size, color: v.color }, material ? "MATERIAL" : undefined) : "Item",
      imageUrl: images.get(variantId) ?? null,
      change,
      unit: v?.product.stockUnit || "pcs",
    };
  };

  const adminIds = [...new Set([...entries.map((e) => e.createdByAdminId), ...decided.map((a) => a.decidedByAdminId)].filter((x): x is string => Boolean(x)))];
  const admins = adminIds.length ? await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, email: true } }) : [];
  const who = new Map(admins.map((a) => [a.id, a.name || a.email]));
  const money = (n: number | null | undefined) => (viewer.canSeeCost && n !== null && n !== undefined ? Number(n) : null);

  const events: StockEvent[] = [];
  for (const e of entries) {
    const s = e.steps as Record<string, unknown>;
    const by = e.createdByAdminId ? who.get(e.createdByAdminId) ?? null : null;
    if (e.kind === "PURCHASE") {
      const r = s.request as { supplierName: string; note: string | null; lines: Array<{ variantId: string; quantity: number }> };
      events.push({ id: e.id, kind: "BOUGHT", at: e.createdAt, by, items: r.lines.map((l) => item(l.variantId, l.quantity)), context: r.supplierName, value: money(s.total as number), pending: !e.completedAt, note: r.note });
    } else if (e.kind === "FILL") {
      const r = s.request as { variantId: string; quantity: number; note?: string | null; wasteReason?: string | null };
      const auto = !e.createdByAdminId && (r.note ?? "").startsWith("Filled for a booked parcel");
      if (!e.completedAt && auto) continue; // a booking fill that stopped shows as its FILL_PROBLEM
      events.push({ id: e.id, kind: auto ? "AUTO_FILLED" : "FILLED", at: e.createdAt, by, items: [item(r.variantId, r.quantity)], context: null, value: null, pending: !e.completedAt, note: r.wasteReason ? `Waste: ${r.wasteReason}` : null });
    } else if (e.kind === "COUNT") {
      const lines = (s.lines as CountLineStep[]) ?? [];
      const differ = lines.filter((l) => (l.difference ?? 0) !== 0);
      events.push({
        id: e.id, kind: "COUNTED", at: e.createdAt, by,
        items: differ.map((l) => item(l.variantId, l.difference ?? 0)),
        context: String(lines.length), value: null,
        pending: lines.some((l) => l.pendingApprovalId), note: null,
      });
    }
  }
  for (const a of decided) {
    events.push({ id: a.id, kind: a.status === "APPROVED" ? "APPROVED" : "REJECTED", at: a.decidedAt!, by: a.decidedByAdminId ? who.get(a.decidedByAdminId) ?? null : null, items: [item(a.variantId, a.status === "APPROVED" ? a.difference : 0)], context: null, value: money(a.value === null ? null : Number(a.value)), pending: false, note: a.decisionNote });
  }
  for (const p of problems) {
    events.push({ id: p.id, kind: "FILL_PROBLEM", at: p.createdAt, by: null, items: [item(p.variantId, p.units)], context: p.order.orderNumber, value: null, pending: !p.resolvedAt, note: p.reason });
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  // what was done on the business's today
  const today = businessToday(business);
  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const todays = events.filter((e) => dayOf(e.at) === today);
  const sum = (kinds: StockEventKind[]) => todays.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.items.reduce((t, i) => t + Math.max(0, i.change ?? 0), 0), 0);

  return {
    events: events.slice(0, limit).map((e) => ({ ...e, at: e.at.toISOString() })),
    today: {
      date: today,
      purchases: todays.filter((e) => e.kind === "BOUGHT").length,
      bottlesFilled: sum(["FILLED", "AUTO_FILLED"]),
      counts: todays.filter((e) => e.kind === "COUNTED").length,
      decisions: todays.filter((e) => e.kind === "APPROVED" || e.kind === "REJECTED").length,
    },
  };
}
export type StockActivity = Awaited<ReturnType<typeof stockActivity>>;
