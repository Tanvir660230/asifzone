/**
 * BullMQ workers with observability (Phase 11, contract §6.1/§6.3). Every job runs inside its own context: the request's
 * correlation ID when the job carries one (`job.data.correlationId`), otherwise a new ID per job / scheduled tick. Failures
 * are captured (and re-thrown so BullMQ's own retry/failure handling is unchanged); durations are logged.
 */
import { Worker, type Job, type WorkerOptions } from "bullmq";
import { acceptCorrelationId, runWithContext } from "./context";
import { captureError } from "./error-capture";
import { logger } from "./logger";
import { namespace } from "../../config/installation";

export function jobContextId(job: Pick<Job, "data">): string {
  return acceptCorrelationId((job.data as { correlationId?: unknown } | undefined)?.correlationId);
}

/** The per-job wrapper (exported for tests): context, duration, capture-and-rethrow. */
export function observeJob<T>(queueName: string, processor: (job: Job) => Promise<T>) {
  return (job: Job) =>
    runWithContext({ correlationId: jobContextId(job), operation: `${queueName}:${job.name}` }, async () => {
      const started = Date.now();
      try {
        const result = await processor(job);
        logger.debug("job completed", { queue: queueName, job: job.name, durationMs: Date.now() - started });
        return result;
      } catch (err) {
        captureError(err, { queue: queueName, job: job.name, durationMs: Date.now() - started });
        throw err;
      }
    });
}

export function createObservedWorker<T = unknown>(queueName: string, processor: (job: Job) => Promise<T>, opts: WorkerOptions): Worker {
  // Same prefix as lib/queue.ts createQueue (taken from the installation directly so importing this file opens no connection).
  const worker = new Worker(queueName, observeJob(queueName, processor), { ...opts, prefix: namespace.queuePrefix });
  worker.on("error", (err) => captureError(err, { queue: queueName, scope: "worker" }));
  return worker;
}
