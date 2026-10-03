import { Queue, Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { purgeExpiredTrash } from "../modules/storage/storage.service";

const QUEUE_NAME = "storage-trash-purge";

/** Daily: permanently deletes upload trash batches past their retention (see storage.service.ts).
 * Same BullMQ repeatable-job pattern as courier-status-cron.ts. */
export async function startStorageTrashCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  new Worker(
    QUEUE_NAME,
    async () => {
      const purged = await purgeExpiredTrash();
      if (purged > 0) console.log(`[storage-trash-cron] purged ${purged} expired trash batch(es)`);
    },
    { connection: queueConnection },
  );

  // 22:30 UTC = 4:30 AM Bangladesh time, after the nightly backup.
  await queue.upsertJobScheduler("storage-trash-purge", { pattern: "30 22 * * *" }, { name: "purge" });
}
