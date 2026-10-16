import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { logger } from "../lib/observability/logger";
import { purgeOldSiteHealthData } from "../modules/ops/web-vitals.service";

const QUEUE_NAME = "site-health-retention";

/** Daily: drops speed samples older than 30 days and error groups not seen for 90 days (modules/ops/web-vitals.service.ts).
 * Same BullMQ repeatable-job pattern as storage-trash-cron.ts. */
export async function startSiteHealthRetentionCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const { samples, errors } = await purgeOldSiteHealthData();
      if (samples + errors > 0) logger.info(`[site-health-retention] removed ${samples} speed sample(s), ${errors} old error group(s)`);
    },
    { connection: queueConnection },
  );

  // 22:45 UTC = 4:45 AM Bangladesh time, after the storage trash purge.
  await queue.upsertJobScheduler("site-health-retention", { pattern: "45 22 * * *" }, { name: "purge" });
}
