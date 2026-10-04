import { Queue } from "bullmq";
import { createObservedWorker } from "../lib/observability/jobs";
import { logger } from "../lib/observability/logger";
import { queueConnection } from "../lib/queue";
import { purgeExpiredTrash } from "../modules/storage/storage.service";

const QUEUE_NAME = "storage-trash-purge";

/** Daily: permanently deletes upload trash batches past their retention (see storage.service.ts).
 * Same BullMQ repeatable-job pattern as courier-status-cron.ts. */
export async function startStorageTrashCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const purged = await purgeExpiredTrash();
      if (purged > 0) logger.info(`[storage-trash-cron] purged ${purged} expired trash batch(es)`);
    },
    { connection: queueConnection },
  );

  // 22:30 UTC = 4:30 AM Bangladesh time, after the nightly backup.
  await queue.upsertJobScheduler("storage-trash-purge", { pattern: "30 22 * * *" }, { name: "purge" });
}
