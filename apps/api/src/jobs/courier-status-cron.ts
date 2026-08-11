import { Queue, Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { syncPendingCourierStatuses } from "../modules/courier/courier.service";

const QUEUE_NAME = "courier-status-sync";

/** Runs every 15 minutes via a BullMQ repeatable job, re-checking Steadfast's status for every
 * order that's been booked but hasn't reached a terminal delivery state yet. This is the safety
 * net behind the Steadfast webhook (courier.routes.ts) — it keeps order status correct even if the
 * merchant never configured a Notify URL in the Steadfast panel, or a single webhook delivery got
 * dropped in transit. Same pattern as cart-recovery-cron.ts. */
export async function startCourierStatusCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  new Worker(
    QUEUE_NAME,
    async () => {
      const changed = await syncPendingCourierStatuses();
      if (changed > 0) console.log(`[courier-status-cron] status changed for ${changed} order(s)`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("courier-status-sync", { pattern: "*/15 * * * *" }, { name: "sync" });
}
