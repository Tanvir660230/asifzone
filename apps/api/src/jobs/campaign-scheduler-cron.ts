import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { promoteDueCampaigns } from "../modules/campaigns/campaign.service";
import { logger } from "../lib/observability/logger";

const QUEUE_NAME = "campaign-scheduler";

/** Runs every minute via a BullMQ repeatable job, promoting any SCHEDULED campaign whose
 * scheduledAt has arrived into the send queue — same pattern as flash-sale-cron.ts. */
export async function startCampaignSchedulerCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const promoted = await promoteDueCampaigns();
      if (promoted > 0) logger.info(`[campaign-scheduler-cron] promoted ${promoted} campaign(s) to send`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("campaign-scheduler-sync", { pattern: "* * * * *" }, { name: "sync" });
}
