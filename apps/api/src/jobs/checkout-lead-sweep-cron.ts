import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { logger } from "../lib/observability/logger";
import { sweepCheckoutLeads } from "../modules/checkout-leads/checkout-lead.service";
import { storeContext } from "../domain/metrics/store-time";
import { DAILY_SCHEDULES, repeatFor } from "./daily-schedules";

const QUEUE_NAME = "checkout-lead-sweep";

/** Daily: incomplete orders nobody reached in 3 days close; leads older than 30 days are deleted (docs/INCOMPLETE_ORDERS.md).
 * Same BullMQ repeatable-job pattern as site-health-retention-cron.ts. Safe to repeat. */
export async function startCheckoutLeadSweepCron() {
  const queue = createQueue(QUEUE_NAME);
  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const { expired, deleted } = await sweepCheckoutLeads();
      if (expired + deleted > 0) logger.info(`[checkout-lead-sweep] closed ${expired} unreached lead(s), deleted ${deleted} old lead(s)`);
    },
    { connection: queueConnection },
  );
  const { timezone } = await storeContext();
  await queue.upsertJobScheduler("checkout-lead-sweep", repeatFor(DAILY_SCHEDULES.checkoutLeadSweep, timezone), { name: "sweep" });
}
