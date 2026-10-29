import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { syncPendingCourierStatuses } from "../modules/courier/courier.service";
import { logger } from "../lib/observability/logger";
import { fillMissingReferences, syncRecentShipments } from "../domain/shipments/shipment-sync";

const QUEUE_NAME = "courier-status-sync";

/** Runs every 15 minutes via a BullMQ repeatable job, re-checking Steadfast's status for every booked parcel that is due
 * (courier.service.ts syncPendingCourierStatuses: by age, bounded per run, stops on a 429). This is the safety net behind
 * the Steadfast webhook (courier.routes.ts) — it keeps order status correct even if the merchant never configured a Notify
 * URL in the Steadfast panel, or a webhook delivery got dropped in transit. It never stops: the webhook can only slow it
 * (courier-sync-policy.ts, capped by COURIER_POLL_MAX_LEVEL). Same pattern as cart-recovery-cron.ts. */
export async function startCourierStatusCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const sweep = await syncPendingCourierStatuses();
      if (sweep.changed > 0 || sweep.rateLimited || sweep.due > sweep.checked) {
        logger.info(`[courier-status-cron] checked ${sweep.checked} of ${sweep.due} due, ${sweep.changed} changed, level ${sweep.level}${sweep.rateLimited ? ", stopped on a rate limit" : ""}`);
      }
      // Courier costs (docs/COURIER_COSTS.md): legs of recently touched orders (status changes by staff, manual carriers).
      await syncRecentShipments();
      await fillMissingReferences();
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("courier-status-sync", { pattern: "*/15 * * * *" }, { name: "sync" });
}
