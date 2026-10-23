/**
 * Goods sold outside the website (courier-panel parcels, docs/FINANCE_OWNER_BOOKS.md) are costed when their payout posts —
 * an estimate credited to 1690 "Stock sent outside the website", a contra to inventory, because the site's stock still
 * counts those units. When the site's stock is later brought down (a count correction, a loss), that decrease is first
 * the goods already costed outside: it comes off 1690 instead of being a second cost. This is the only place that says how
 * much of a decrease that is.
 */
import type { Prisma } from "@prisma/client";
import type { AppTransactionClient } from "../../config/prisma";
import { toMinor } from "./finance-values";

/** Stock decreases that can be goods already sent outside (not damage, not packaging). */
export const OUTSIDE_RELEASE_REASONS = new Set(["ADJUSTMENT", "LOST"]);

/**
 * The part of a stock decrease of `decreaseMinor` that releases 1690: its posted credit balance less the releases already
 * recorded and still waiting to post. Serialised per business, in the caller's transaction (the release is recorded there).
 */
export async function outsideReleaseInTx(tx: AppTransactionClient, businessId: string, currency: string, decreaseMinor: number): Promise<number> {
  if (decreaseMinor <= 0) return 0;
  const mapping = await tx.accountMapping.findUnique({ where: { businessId_key: { businessId, key: "asset.inventory_sent_outside" } }, select: { accountId: true } });
  if (!mapping) return 0;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-outside-release:${businessId}`}))`;
  const [posted] = await tx.$queryRaw<Array<{ held: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(l.credit - l.debit), 0) AS held FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND l."accountId" = ${mapping.accountId}`;
  const [pending] = await tx.$queryRaw<Array<{ minor: bigint }>>`
    SELECT COALESCE(SUM((payload->>'outsideReleaseMinor')::bigint), 0)::bigint AS minor FROM "FinancialEvent"
    WHERE "businessId" = ${businessId} AND status IN ('RECEIVED', 'FAILED') AND payload ? 'outsideReleaseMinor'`;
  const heldMinor = posted ? Math.sign(Number(posted.held)) * toMinor(posted.held.abs(), currency) : 0;
  const available = heldMinor - Number(pending?.minor ?? 0n);
  return Math.max(0, Math.min(decreaseMinor, available));
}
