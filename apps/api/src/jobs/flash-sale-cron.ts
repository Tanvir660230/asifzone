import { createObservedWorker } from "../lib/observability/jobs";
import { Queue } from "bullmq";
import { queueConnection } from "../lib/queue";
import { syncFlashSaleActivation } from "../modules/flash-sales/flash-sale.service";
import { rebuildAllReadModels } from "../domain/storefront/read-model.service";
import { logger } from "../lib/observability/logger";

const QUEUE_NAME = "flash-sale-activation";

/** Runs every minute via a BullMQ repeatable job so a scheduled flash sale goes live/ends on time
 * without a manual admin toggle or a redeploy. */
export async function startFlashSaleCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  createObservedWorker(
    QUEUE_NAME,
    async (job) => {
      // Storefront Read Model reconciliation (docs/STOREFRONT_READ_MODEL.md §5): a full, deterministic rebuild closes
      // the one staleness the freshness guard can't see (a concurrent write whose updatedAt predates the row's).
      if (job.name === "read-model-rebuild") {
        const rebuilt = await rebuildAllReadModels();
        logger.info(`[read-model] periodic rebuild: ${rebuilt} row(s)`);
        return;
      }
      const changed = await syncFlashSaleActivation();
      if (changed > 0) logger.info(`[flash-sale-cron] activation changed for ${changed} sale(s)`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("flash-sale-sync", { pattern: "* * * * *" }, { name: "sync" });
  await queue.upsertJobScheduler("storefront-read-model-rebuild", { pattern: "*/15 * * * *" }, { name: "read-model-rebuild" });
}
