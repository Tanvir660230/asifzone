import { Queue, Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { cleanupOutbox, dispatchOutbox, markDispatcherHeartbeat, processOutboxEvent, reapStaleClaims } from "../domain/outbox/processor";

/** Phase 8 outbox transport (docs/PHASE_8_AUDIT.md). One BullMQ queue carries three job kinds:
 *   dispatch  every 3 s (job scheduler — one schedule however many API instances run): reap expired claims, claim due
 *             outbox rows (SKIP LOCKED — concurrent dispatchers never take the same row) and enqueue a `deliver` job each;
 *   deliver   one outbox event → processOutboxEvent (idempotent; retry/failure state is kept on the row, so BullMQ itself
 *             runs each job once — `attempts: 1`);
 *   cleanup   daily retention of processed rows.
 * If Redis is down nothing is lost: rows stay PENDING in PostgreSQL until a dispatch succeeds. */
export const OUTBOX_QUEUE = "outbox";

export async function startOutboxWorker() {
  const queue = new Queue(OUTBOX_QUEUE, { connection: queueConnection });
  const enqueue = async ({ eventId, jobId }: { eventId: string; jobId: string }) => {
    await queue.add("deliver", { eventId }, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 60 * 60 } });
  };

  new Worker(
    OUTBOX_QUEUE,
    async (job) => {
      if (job.name === "deliver") {
        const result = await processOutboxEvent((job.data as { eventId: string }).eventId);
        if (result.outcome === "retry" || result.outcome === "failed") console.error(`[outbox] ${(job.data as { eventId: string }).eventId} ${result.outcome}: ${result.error}`);
      } else if (job.name === "dispatch") {
        await reapStaleClaims();
        await dispatchOutbox({ enqueue });
        await markDispatcherHeartbeat();
      } else if (job.name === "cleanup") {
        const removed = await cleanupOutbox();
        if (removed) console.log(`[outbox] retention: removed ${removed} processed event(s)`);
      }
    },
    { connection: queueConnection, concurrency: 5 },
  );

  await queue.upsertJobScheduler("outbox-dispatch", { every: 3_000 }, { name: "dispatch" });
  await queue.upsertJobScheduler("outbox-cleanup", { pattern: "0 3 * * *" }, { name: "cleanup" });
}
