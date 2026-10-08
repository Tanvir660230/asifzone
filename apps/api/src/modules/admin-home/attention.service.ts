import { prisma } from "../../config/prisma";
import { can, type AdminIdentity } from "../../domain/auth/authorization";
import { getOrderStats } from "../orders/order.service";
import { getPaymentsOverview } from "../payments/payments-overview.service";
import { countUnreadNotifications } from "../notifications/notification.service";
import { countOpenConversations } from "../inbox/inbox.service";

/**
 * Everything waiting on an admin, in one response (Blueprint V2 PERF-03, §I4) — the sidebar badges, the bell and Home's
 * Needs-attention row read this one poll instead of five. Each section is computed only when this admin holds the
 * permission its own endpoint enforces, and is `null` otherwise, so the composite never shows more than the parts would.
 * The sections are the same functions those endpoints serve: one number, one predicate.
 */
export async function adminAttention(identity: AdminIdentity) {
  const content = can(identity, "content.manage");
  const [orders, payments, pendingReviews, unreadFeedback, unreadNotifications] = await Promise.all([
    can(identity, "orders.read") ? getOrderStats() : null,
    can(identity, "payments.read") ? getPaymentsOverview() : null,
    content ? prisma.productReview.count({ where: { status: "PENDING" } }) : null,
    content ? countOpenConversations() : null,
    countUnreadNotifications(identity),
  ]);
  return { orders, payments, pendingReviews, unreadFeedback, unreadNotifications };
}

export type AdminAttention = Awaited<ReturnType<typeof adminAttention>>;
