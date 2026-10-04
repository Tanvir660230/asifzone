import { createObservedWorker } from "../lib/observability/jobs";
import { Queue } from "bullmq";
import { queueConnection } from "../lib/queue";
import { expireStalePaymentSessions, reconcileStuckEpsSessions } from "../modules/payments/payment.service";
import { logger } from "../lib/observability/logger";

const QUEUE_NAME = "payment-reconciliation";

/** Runs every 5 minutes via a BullMQ repeatable job. Two responsibilities per tick:
 *  1. Re-check EPS's own transaction status for every EPS PaymentSession still ACTIVE a few minutes
 *     after checkout — EPS has no webhook/IPN, only a browser GET redirect, so this is the safety
 *     net for the case where the customer's tab closes, crashes, or loses connection before that
 *     redirect lands.
 *  2. Expire any ACTIVE session (either provider) that's past its window with no gateway signal at
 *     all — including SSLCommerz, whose IPN could in principle silently fail to reach us with no
 *     cron safety net today otherwise. Without this, a stale session would sit ACTIVE forever and
 *     the one-ACTIVE-session-per-order index would permanently block retry.
 * Same pattern as courier-status-cron.ts. */
export async function startPaymentReconciliationCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const recovered = await reconcileStuckEpsSessions();
      const expired = await expireStalePaymentSessions();
      if (recovered > 0) logger.info(`[payment-reconciliation-cron] recovered ${recovered} stuck EPS session(s)`);
      if (expired > 0) logger.info(`[payment-reconciliation-cron] expired ${expired} stale session(s)`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("payment-reconciliation", { pattern: "*/5 * * * *" }, { name: "reconcile" });
}
