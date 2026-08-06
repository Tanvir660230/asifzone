import { Queue, Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { runCartRecoverySweep } from "../modules/cart/cart-recovery.service";

const QUEUE_NAME = "cart-recovery";

/** Runs every 15 minutes via a BullMQ repeatable job, sweeping for real carts abandoned past the
 * threshold and emailing (via the dev-mode mailer stub until a real provider is connected) a real
 * recovery message. BullMQ (backed by the existing Redis) gives this retries and dedup-across-instances
 * that a raw node-cron schedule can't. */
export async function startCartRecoveryCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  new Worker(
    QUEUE_NAME,
    async () => {
      const sent = await runCartRecoverySweep();
      if (sent > 0) console.log(`[cart-recovery-cron] sent ${sent} recovery email(s)`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("cart-recovery-sweep", { pattern: "*/15 * * * *" }, { name: "sweep" });
}
