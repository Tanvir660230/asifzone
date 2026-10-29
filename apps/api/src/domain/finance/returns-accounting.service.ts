/**
 * Returns accounting set-up and reconciliation (blueprint P0.4; owner decisions Q-A, Q-B; tab 11 §2, §5).
 *
 * Account 1620 "Goods awaiting return" (asset.goods_awaiting_return) is provisioned only when the owner turns the returns
 * rule on (business settings: returnsReceiptRuleEffectiveDate) — chart-provisioning rules: an account only when its code is
 * free, a mapping only when it is missing; idempotent. Turning the rule on is refused when it can't be mapped.
 *
 * The check "Goods awaiting return = what is still to come back": the account's posted balance equals, over the agreed
 * returns not withdrawn, (agreed − received − written off) × the line's recorded unit cost (or its approved estimate) —
 * in total and per order, which every posting names as its party. A DIFFERENCE keeps the month from being Final like any
 * other check.
 */
import { RETURNS_MAPPING_KEYS, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import type { FinanceBusinessInfo, FinanceContext } from "./finance-context";
import { chartState, provisionTemplateAccountsInTx } from "./chart-provisioning";
import { businessDate } from "@clothing-brand/shared";
import { financeError, toMajorNumber, toMinor } from "./finance-values";

export const RETURNS_SETUP_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:returns-setup" };

export async function ensureReturnsAccountingInTx(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id">, actor: FinanceActor = RETURNS_SETUP_ACTOR) {
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  if (RETURNS_MAPPING_KEYS.every((k) => mapped.has(k))) return { changes: [] as string[] };
  const changes = await provisionTemplateAccountsInTx(tx, business, { needed: new Set<string>(RETURNS_MAPPING_KEYS), byCode, mapped, audits, actor, reason: "Returns rule: goods awaiting return" });
  await recordFinanceAudit(tx, audits);
  const missing: AccountMappingKey[] = RETURNS_MAPPING_KEYS.filter((k) => !mapped.has(k));
  if (missing.length) throw financeError(409, "MAPPINGS_MISSING", `Map these accounts in Finance → Setup → Account mapping first: ${missing.join(", ")}`, { missing });
  return { changes };
}

/** The reconciliation check (registered in reconciliation.service.ts). */
export async function goodsAwaitingReturnCheck(ctx: FinanceContext) {
  const cur = ctx.business.baseCurrency;
  const map = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId: ctx.business.id, key: "asset.goods_awaiting_return" } } });
  const agreed = await prisma.returnExpectation.findMany({
    where: { status: { not: "WITHDRAWN" } },
    select: { id: true, orderId: true, orderItemId: true, quantity: true, receivedGood: true, receivedDamaged: true, lostQuantity: true, approvedAt: true, orderItem: { select: { unitCostSnapshot: true } } },
  });
  if (!map && !agreed.length) return { status: "NOT_APPLICABLE" as const, details: { reason: "the returns rule has not been used" } };
  // Only what the books carry: agreements from the opening date on (earlier ones are opening balances).
  const opening = ctx.business.openingDate;
  const inBooks = agreed.filter((e) => !opening || businessDate(e.approvedAt, ctx.business.timezone) >= opening);
  const estimates = new Map(
    (await prisma.financeException.findMany({
      where: { businessId: ctx.business.id, kind: "MISSING_COST", resolution: "ESTIMATE_APPROVED", key: { in: inBooks.map((e) => `cost:line:${e.orderItemId}`) } },
      select: { key: true, estimatedUnitCost: true },
    })).filter((e) => e.estimatedUnitCost).map((e) => [e.key.slice("cost:line:".length), toMinor(e.estimatedUnitCost!, cur)]),
  );
  const expectedBy = new Map<string, number>();
  const unknownCost: string[] = [];
  for (const e of inBooks) {
    const open = e.quantity - e.receivedGood - e.receivedDamaged - e.lostQuantity;
    if (open <= 0) continue;
    const unit = e.orderItem.unitCostSnapshot ?? estimates.get(e.orderItemId) ?? null;
    if (unit === null) {
      unknownCost.push(e.id);
      continue;
    }
    expectedBy.set(e.orderId, (expectedBy.get(e.orderId) ?? 0) + open * unit);
  }
  const booksBy = new Map<string, number>();
  if (map) {
    const rows = await prisma.$queryRaw<Array<{ partyId: string | null; d: unknown; c: unknown }>>`
      SELECT l."partyId", COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
      WHERE e."businessId" = ${ctx.business.id} AND e.status = 'POSTED' AND l."accountId" = ${map.accountId} GROUP BY l."partyId"`;
    for (const r of rows) booksBy.set(r.partyId ?? "(no order)", toMinor(String(r.d), cur) - toMinor(String(r.c), cur));
  }
  const expected = [...expectedBy.values()].reduce((s, v) => s + v, 0);
  const actual = [...booksBy.values()].reduce((s, v) => s + v, 0);
  const orders = [...new Set([...expectedBy.keys(), ...booksBy.keys()])]
    .filter((k) => (expectedBy.get(k) ?? 0) !== (booksBy.get(k) ?? 0))
    .slice(0, 50)
    .map((orderId) => ({ orderId, stillToComeBack: toMajorNumber(expectedBy.get(orderId) ?? 0, cur), books: toMajorNumber(booksBy.get(orderId) ?? 0, cur) }));
  const unposted = await prisma.financialEvent.findMany({ where: { businessId: ctx.business.id, eventType: { in: ["commerce.return.awaiting", "commerce.return.received", "commerce.return.not_returned"] }, status: { in: ["RECEIVED", "FAILED"] } }, select: { id: true, eventKey: true, status: true, lastError: true }, take: 20 });
  return {
    status: expected === actual && !orders.length && !unposted.length ? ("MATCHED" as const) : ("DIFFERENCE" as const),
    expected,
    actual,
    details: { ordersWithDifference: orders, linesWithoutCost: unknownCost.length, unpostedEvents: unposted },
  };
}
