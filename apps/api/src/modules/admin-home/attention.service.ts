import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { can, type AdminIdentity } from "../../domain/auth/authorization";
import { getOrderStats, listParcelsToReceive } from "../orders/order.service";
import { getPaymentsOverview } from "../payments/payments-overview.service";
import { countUnreadNotifications } from "../notifications/notification.service";
import { countOpenConversations } from "../inbox/inbox.service";
import { countOpenErrors } from "../ops/errors.service";

/**
 * Everything waiting on an admin, in one response (Blueprint V2 PERF-03, §I4) — the sidebar badges, the bell and Home's
 * Needs-attention row read this one poll instead of five. Each section is computed only when this admin holds the
 * permission its own endpoint enforces, and is `null` otherwise, so the composite never shows more than the parts would.
 * The sections are the same functions those endpoints serve: one number, one predicate.
 */
export async function adminAttention(identity: AdminIdentity) {
  const content = can(identity, "content.manage");
  const [orders, payments, pendingReviews, unreadFeedback, unreadNotifications, openErrors, possibleDuplicatePurchases, stock, parcels] = await Promise.all([
    can(identity, "orders.read") ? getOrderStats() : null,
    can(identity, "payments.read") ? getPaymentsOverview() : null,
    content ? prisma.productReview.count({ where: { status: "PENDING" } }) : null,
    content ? countOpenConversations() : null,
    countUnreadNotifications(identity),
    can(identity, "ops.read") ? countOpenErrors() : null,
    can(identity, "purchasing.read") ? countPossibleDuplicatePurchases() : null,
    can(identity, "inventory.read") ? stockWaiting() : null,
    can(identity, "orders.read") ? listParcelsToReceive() : null,
  ]);
  const parcelsToReceive = parcels ? { total: parcels.parcels.length, overdue: parcels.overdue, followUpDays: parcels.followUpDays } : null;
  return { orders, payments, pendingReviews, unreadFeedback, unreadNotifications, openErrors, possibleDuplicatePurchases, stock, parcelsToReceive };
}

/** Blueprint P0.3 on Home: recent receipts flagged as a possible duplicate that nobody explained (no reason given). */
export const DUPLICATE_PURCHASE_LOOKBACK_DAYS = 30;
function countPossibleDuplicatePurchases() {
  return prisma.goodsReceipt.count({
    where: { duplicateWarning: { not: Prisma.DbNull }, duplicateReason: null, status: { not: "REVERSED" }, createdAt: { gte: new Date(Date.now() - DUPLICATE_PURCHASE_LOOKBACK_DAYS * 86_400_000) } },
  });
}

/** Stock work waiting on a person (docs/STOCK_HUB.md §7): count losses to approve, bottles a booking couldn't fill. */
async function stockWaiting() {
  const [countLossesToApprove, fillFailures] = await Promise.all([
    prisma.stockCountApproval.count({ where: { status: "PENDING" } }),
    prisma.stockAutoFillFailure.count({ where: { resolvedAt: null } }),
  ]);
  return { countLossesToApprove, fillFailures };
}

export type AdminAttention = Awaited<ReturnType<typeof adminAttention>>;
