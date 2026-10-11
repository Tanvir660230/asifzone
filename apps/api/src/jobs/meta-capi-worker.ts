
import { createObservedWorker } from "../lib/observability/jobs";
import { queueConnection } from "../lib/queue";
import { META_CAPI_QUEUE, processMetaPurchase, type MetaPurchaseJobData } from "../lib/meta/purchase";
import { logger } from "../lib/observability/logger";
import { getProviders } from "../providers/registry";

/** Drains Conversions API jobs queued before Phase 8 (Meta now goes through the outbox) — retries
 * and backoff are configured per job there. Not started at all while CAPI is unconfigured, so a dev
 * machine or CI never holds a worker open for a queue nothing writes to. */
export async function startMetaCapiWorker() {
  if (!getProviders().serverEvents.enabled()) {
    logger.info("[meta-capi] Conversions API disabled (META_PIXEL_ID/META_ACCESS_TOKEN unset, or non-production without META_TEST_EVENT_CODE)");
    return;
  }

  createObservedWorker(
    META_CAPI_QUEUE,
    async (job) => {
      if (job.name === "purchase") await processMetaPurchase(job.data as MetaPurchaseJobData);
    },
    { connection: queueConnection },
  );
}
