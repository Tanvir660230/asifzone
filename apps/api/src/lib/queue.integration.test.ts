import { describe, it, expect, afterAll } from "vitest";
import { Worker } from "bullmq";
import { createQueue, JOB_RETENTION, queueConnection, QUEUE_PREFIX, trimFinishedJobs } from "./queue";

// Finished jobs must not pile up in Redis (2026-10-25: both stores' Redis held ~0.7-0.8 GB of completed cron runs on a
// 3.8 GB VPS, and the deploy build ran out of memory). Every queue keeps a day / the last 200 completed and a week / the
// last 1,000 failed, scheduled (cron) jobs included; what piled up before is trimmed once at start.

const name = `vitest-retention-${Date.now()}`;
const queue = createQueue(name);

afterAll(async () => {
  await queue.obliterate({ force: true });
  await queue.close();
});

describe("job retention", () => {
  it("every queue keeps finished jobs only for a while, unless it says otherwise", () => {
    expect(queue.defaultJobOptions).toMatchObject(JOB_RETENTION);
    const own = createQueue(`${name}-own`, { defaultJobOptions: { removeOnComplete: true } });
    expect(own.defaultJobOptions.removeOnComplete).toBe(true);
    expect(own.defaultJobOptions.removeOnFail).toEqual(JOB_RETENTION.removeOnFail);
    void own.close();
  });

  it("a scheduled (cron) job inherits the retention", async () => {
    await queue.upsertJobScheduler("vitest-every-minute", { pattern: "* * * * *" }, { name: "tick" });
    const delayed = await queue.getDelayed();
    expect(delayed[0]?.opts.removeOnComplete).toEqual(JOB_RETENTION.removeOnComplete);
    await queue.removeJobScheduler("vitest-every-minute");
  });

  it("completed jobs that piled up before are trimmed", async () => {
    // jobs added with no retention at all, as the queues did until now
    const raw = createQueue(`${name}-raw`, { defaultJobOptions: { removeOnComplete: false, removeOnFail: false } });
    for (let i = 0; i < 5; i++) await raw.add("old", { i });
    const worker = new Worker(`${name}-raw`, async () => undefined, { connection: queueConnection, prefix: QUEUE_PREFIX });
    await new Promise<void>((resolve) => {
      let done = 0;
      worker.on("completed", () => { if (++done === 5) resolve(); });
    });
    await worker.close();
    expect(await raw.getCompletedCount()).toBe(5);
    const removed = await trimFinishedJobs(raw, { completedGraceMs: 0 });
    expect(removed).toBe(5);
    expect(await raw.getCompletedCount()).toBe(0);
    await raw.obliterate({ force: true });
    await raw.close();
  }, 30_000);
});
