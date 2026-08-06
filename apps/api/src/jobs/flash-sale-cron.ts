import { Queue, Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { syncFlashSaleActivation } from "../modules/flash-sales/flash-sale.service";

const QUEUE_NAME = "flash-sale-activation";

/** Runs every minute via a BullMQ repeatable job so a scheduled flash sale goes live/ends on time
 * without a manual admin toggle or a redeploy. */
export async function startFlashSaleCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  new Worker(
    QUEUE_NAME,
    async () => {
      const changed = await syncFlashSaleActivation();
      if (changed > 0) console.log(`[flash-sale-cron] activation changed for ${changed} sale(s)`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("flash-sale-sync", { pattern: "* * * * *" }, { name: "sync" });
}
