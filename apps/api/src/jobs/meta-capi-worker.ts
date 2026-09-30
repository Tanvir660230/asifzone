import { Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { isMetaCapiEnabled } from "../lib/meta/capi";
import { META_CAPI_QUEUE, processMetaPurchase, type MetaPurchaseJobData } from "../lib/meta/purchase";

/** Drains Conversions API jobs queued before Phase 8 (Meta now goes through the outbox) — retries
 * and backoff are configured per job there. Not started at all while CAPI is unconfigured, so a dev
 * machine or CI never holds a worker open for a queue nothing writes to. */
export async function startMetaCapiWorker() {
  if (!isMetaCapiEnabled()) {
    console.log("[meta-capi] Conversions API disabled (META_PIXEL_ID/META_ACCESS_TOKEN unset, or non-production without META_TEST_EVENT_CODE)");
    return;
  }

  new Worker(
    META_CAPI_QUEUE,
    async (job) => {
      if (job.name === "purchase") await processMetaPurchase(job.data as MetaPurchaseJobData);
    },
    { connection: queueConnection },
  );
}
