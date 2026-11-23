/**
 * Spending (docs/FINANCE_SPENDING.md) — "how much did I spend, and when?" in one list: everything the business spent in a
 * period, by day. Goods and materials count on the day they were BOUGHT (not when they sell), so this is not the profit
 * page's cost: profit counts the cost of what was sold.
 *
 * Where each taka comes from, so nothing is counted twice and nothing is missed:
 *   goods     posted goods receipts (what arrived, at its bill price), the extras paid to bring them (landed costs), and
 *             purchases saved before stock costing is live (they make no receipt; their money is not in the books yet)
 *   expenses  posted expenses, and prepaid costs (a domain, a licence) whole on the day they were paid
 *   the rest  what the books took that day on expense accounts — courier, payment fees, ads, salaries, typed journals —
 *             except what is already above, a prepaid cost's monthly share and depreciation (no money moves)
 * Cost of goods sold, stock corrections and the packaging used on parcels are not spending: their purchase was. Read-only.
 */
import { Prisma, type LedgerAccountType } from "@prisma/client";
import { addDays } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toMajorNumber, toMinor } from "./finance-values";

export const SPENDING_KINDS = ["GOODS", "ADS", "DELIVERY", "PACKAGING", "FEES", "SALARIES", "OTHER"] as const;
export type SpendingKind = (typeof SPENDING_KINDS)[number];

export interface SpendingRow {
  kind: SpendingKind;
  title: string;
  detail: string | null;
  amount: number;
  /** The admin page behind the row. */
  href: string | null;
  /** The items of a purchase. */
  lines?: SpendingItem[];
  /** The record behind the row, when one can be opened or taken back (Add cost undo). */
  source?: { type: "Expense" | "PrepaidCost" | "LandedCost" | "GoodsReceipt"; id: string; reversible: boolean } | null;
  /** Whose money paid it. */
  paidFrom?: string | null;
}

export interface SpendingItem {
  name: string;
  quantity: number;
  /** pcs, ml… when the purchase says it. */
  unit: string | null;
  amount: number;
}

const MAX_DAYS = 366;
/** Ledger source types on an expense account that move no money in the period. */
const NOT_SPENDING = ["PrepaidCost", "DepreciationRun"];

export async function spending(q: { from?: string; to?: string }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const to = q.to ?? today;
  const from = q.from ?? `${to.slice(0, 7)}-01`;
  if (from > to) throw financeError(400, "PERIOD_RANGE", "The period starts before it ends");
  const len = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  if (len + 1 > MAX_DAYS) throw financeError(400, "PERIOD_TOO_LONG", `Spending covers at most ${MAX_DAYS} days`);
  const range = { gte: dateColumn(from), lte: dateColumn(to) };

  const [receipts, landed, expenses, prepaid, maps, lastAd, entries] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where: { businessId: business.id, status: "POSTED", receiptDate: range },
      include: { supplier: { select: { displayName: true, legalName: true } }, lines: { include: { variant: { select: { size: true, color: true, product: { select: { name: true } } } } }, orderBy: { lineNo: "asc" } } },
      orderBy: { number: "desc" },
    }),
    prisma.landedCost.findMany({ where: { businessId: business.id, reversedAt: null, costDate: range }, include: { movement: { select: { fromAccount: { select: { name: true } } } } } }),
    prisma.expense.findMany({ where: { businessId: business.id, expenseDate: range, movement: { status: "POSTED" } }, include: { expenseAccount: { select: { id: true, name: true } }, movement: { select: { fromAccount: { select: { name: true } } } } }, orderBy: { number: "desc" } }),
    prisma.prepaidCost.findMany({ where: { businessId: business.id, movement: { status: "POSTED", movementDate: range } }, include: { movement: { select: { movementDate: true, fromAccount: { select: { name: true } } } }, expenseAccount: { select: { id: true, name: true } } } }),
    prisma.accountMapping.findMany({ where: { businessId: business.id }, select: { key: true, accountId: true } }),
    prisma.adSpendDay.aggregate({ where: { campaign: { businessId: business.id } }, _max: { date: true } }),
    prisma.stockHubEntry.findMany({ where: { businessId: business.id, kind: "PURCHASE", entryDate: range, completedAt: { not: null } } }),
  ]);
  type Bought = { mode?: string; receiptId?: string; total: number; request: { supplierName: string; lines: Array<{ name: string; unit?: string; quantity: number; amount: number }> } };
  const bought = entries.map((e) => ({ date: businessDateOf(e.entryDate), steps: e.steps as unknown as Bought }));
  const boughtOf = new Map(bought.filter((b) => b.steps.receiptId).map((b) => [b.steps.receiptId!, b.steps]));
  const titleOf = (items: SpendingItem[]) => (items.length === 1 ? items[0]!.name : `${items[0]!.name} and ${items.length - 1} more`);
  const itemsOf = (steps: Bought): SpendingItem[] => steps.request.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit ?? null, amount: l.amount }));

  const keyOf = new Map(maps.map((m) => [m.accountId, m.key]));
  const kindOf = (accountId: string, name: string): SpendingKind => {
    const key = keyOf.get(accountId);
    if (key === "expense.advertising") return "ADS";
    if (key === "expense.courier_fees" || key === "expense.freight_in") return "DELIVERY";
    if (key === "expense.gateway_fees") return "FEES";
    if (key === "expense.salaries" || key === "expense.employer_contributions") return "SALARIES";
    return /packag/i.test(name) ? "PACKAGING" : "OTHER";
  };

  // What the books took on expense accounts, by day — a reversal counts against the entry it reverses. Expenses themselves
  // (their payment movement) come from their own rows.
  const ledger = await prisma.$queryRaw<Array<{ day: string; accountId: string; name: string; type: LedgerAccountType; source: string; description: string; net: Prisma.Decimal }>>`
    SELECT to_char(e."entryDate", 'YYYY-MM-DD') AS day, l."accountId", a.name, a.type, COALESCE(o."sourceType", e."sourceType", '') AS source,
      CASE WHEN COALESCE(o."sourceType", e."sourceType") = 'MANUAL' THEN COALESCE(o.description, e.description) ELSE '' END AS description,
      SUM(l.debit - l.credit) AS net
    FROM "JournalLine" l
    JOIN "JournalEntry" e ON e.id = l."entryId"
    JOIN "LedgerAccount" a ON a.id = l."accountId"
    LEFT JOIN "JournalEntry" o ON o.id = e."reversesEntryId"
    WHERE e."businessId" = ${business.id} AND e.status = 'POSTED' AND a.type IN ('EXPENSE', 'OTHER_EXPENSE')
      AND e."entryDate" >= ${dateColumn(from)}::date AND e."entryDate" <= ${dateColumn(to)}::date
      AND COALESCE(o."sourceType", e."sourceType", '') NOT IN (${Prisma.join(NOT_SPENDING)})
      AND NOT (COALESCE(o."sourceType", e."sourceType", '') = 'TreasuryMovement' AND COALESCE(o."sourceId", e."sourceId") IN (SELECT x."movementId" FROM "Expense" x WHERE x."businessId" = ${business.id}))
    GROUP BY 1, 2, 3, 4, 5, 6`;

  const days = new Map<string, SpendingRow[]>();
  const add = (day: string, row: Omit<SpendingRow, "amount"> & { minor: number }) => {
    if (row.minor === 0) return;
    const { minor, ...rest } = row;
    (days.get(day) ?? days.set(day, []).get(day)!).push({ ...rest, amount: toMajorNumber(minor, cur) });
  };

  for (const r of receipts) {
    // The purchase form's own lines when it was entered there (with units); else the receipt's, one per item.
    const form = boughtOf.get(r.id);
    const merged = new Map<string, SpendingItem>();
    for (const l of r.lines) {
      const v = l.variant;
      const spec = [v.color, v.size].filter((x) => x && !/^(standard|default|one size)$/i.test(x)).join(" ");
      const name = [v.product.name, spec].filter(Boolean).join(" ");
      const amount = toMajorNumber(toMinor(l.value, cur), cur);
      const have = merged.get(name);
      if (have) {
        have.quantity += l.qtyAccepted;
        have.amount = Math.round((have.amount + amount) * 100) / 100;
      } else merged.set(name, { name, quantity: l.qtyAccepted, unit: null, amount });
    }
    const items = form ? itemsOf(form) : [...merged.values()];
    add(businessDateOf(r.receiptDate), {
      kind: "GOODS",
      title: titleOf(items),
      detail: r.supplier.displayName ?? r.supplier.legalName,
      minor: r.lines.reduce((s, l) => s + toMinor(l.value, cur), 0),
      href: "/admin/stock/purchases",
      lines: items,
      source: { type: "GoodsReceipt", id: r.id, reversible: false },
    });
  }
  for (const b of bought) {
    if (b.steps.mode !== "SIMPLE" || b.steps.receiptId) continue;
    const items = itemsOf(b.steps);
    add(b.date, { kind: "GOODS", title: titleOf(items), detail: b.steps.request.supplierName, minor: toMinor(b.steps.total, cur), href: "/admin/stock/purchases", lines: items });
  }
  for (const l of landed) add(businessDateOf(l.costDate), { kind: "GOODS", title: l.description, detail: "Cost of bringing goods", minor: toMinor(l.amount, cur), href: "/admin/finance/landed-costs", source: { type: "LandedCost", id: l.id, reversible: true }, paidFrom: l.movement.fromAccount?.name ?? null });
  for (const e of expenses) {
    add(businessDateOf(e.expenseDate), { kind: kindOf(e.expenseAccount.id, e.expenseAccount.name), title: e.description, detail: e.payee ?? e.expenseAccount.name, minor: toMinor(e.amount, cur), href: "/admin/finance/expenses", source: { type: "Expense", id: e.id, reversible: true }, paidFrom: e.movement.fromAccount?.name ?? null });
  }
  for (const p of prepaid) {
    add(businessDateOf(p.movement.movementDate), { kind: kindOf(p.expenseAccount.id, p.expenseAccount.name), title: p.name, detail: "Paid in advance", minor: toMinor(p.amount, cur), href: "/admin/finance/prepaid", source: { type: "PrepaidCost", id: p.id, reversible: true }, paidFrom: p.movement.fromAccount?.name ?? null });
  }

  // The rest, one row per kind and day (a typed journal keeps its own words).
  const rest = new Map<string, { day: string; kind: SpendingKind; title: string; detail: string | null; href: string | null; minor: number }>();
  const AUTO: Record<SpendingKind, { title: string; detail: string | null; href: string | null }> = {
    GOODS: { title: "Goods", detail: null, href: null },
    ADS: { title: "Ads", detail: null, href: "/admin/finance/ads" },
    DELIVERY: { title: "Delivery charges", detail: "Estimated until Steadfast pays out", href: "/admin/finance/courier" },
    FEES: { title: "Payment fees", detail: null, href: "/admin/finance/courier" },
    SALARIES: { title: "Salaries", detail: null, href: "/admin/finance/payroll" },
    PACKAGING: { title: "Packaging", detail: null, href: "/admin/finance/expenses" },
    OTHER: { title: "Other costs", detail: null, href: "/admin/finance/journals" },
  };
  for (const r of ledger) {
    const kind = kindOf(r.accountId, r.name);
    const manual = r.source === "MANUAL";
    const auto = AUTO[kind];
    const title = manual ? r.description || r.name : kind === "OTHER" || kind === "PACKAGING" ? r.name : auto.title;
    const key = `${r.day}|${kind}|${title}`;
    const net = r.net.toFixed(2);
    const minor = net.startsWith("-") ? -toMinor(net.slice(1), cur) : toMinor(net, cur);
    const have = rest.get(key);
    if (have) have.minor += minor;
    else rest.set(key, { day: r.day, kind, title, detail: manual ? r.name : auto.detail, href: manual ? "/admin/finance/journals" : auto.href, minor });
  }
  for (const r of rest.values()) add(r.day, { kind: r.kind, title: r.title, detail: r.detail, href: r.href, minor: r.minor });

  const minorOf = (v: number) => Math.round(v * 100);
  const kinds = SPENDING_KINDS.map((kind) => {
    const total = [...days.values()].flat().filter((x) => x.kind === kind).reduce((s, x) => s + minorOf(x.amount), 0);
    return { kind, total: total / 100 };
  });
  const total = kinds.reduce((s, k) => s + minorOf(k.total), 0) / 100;
  const lastDay = to < today ? to : addDays(today, -1);
  const adsThrough = lastAd._max.date ? businessDateOf(lastAd._max.date) : null;

  return {
    currency: cur,
    today,
    booksStartedOn: business.openingDate,
    period: { from, to },
    total,
    kinds,
    days: [...days.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, rows]) => ({ date, total: rows.reduce((s, x) => s + minorOf(x.amount), 0) / 100, rows: rows.sort((a, b) => b.amount - a.amount) })),
    /** Ads are entered or imported: the last day that has them, when the period goes on past it — the total is then low. */
    adsMissingAfter: adsThrough && adsThrough < lastDay && adsThrough >= addDays(from, -31) ? adsThrough : null,
  };
}
