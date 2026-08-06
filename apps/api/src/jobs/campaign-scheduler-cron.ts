import { Queue, Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { promoteDueCampaigns } from "../modules/campaigns/campaign.service";

const QUEUE_NAME = "campaign-scheduler";

/** Runs every minute via a BullMQ repeatable job, promoting any SCHEDULED campaign whose
 * scheduledAt has arrived into the send queue — same pattern as flash-sale-cron.ts. */
export async function startCampaignSchedulerCron() {
  const queue = new Queue(QUEUE_NAME, { connection: queueConnection });

  new Worker(
    QUEUE_NAME,
    async () => {
      const promoted = await promoteDueCampaigns();
      if (promoted > 0) console.log(`[campaign-scheduler-cron] promoted ${promoted} campaign(s) to send`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("campaign-scheduler-sync", { pattern: "* * * * *" }, { name: "sync" });
}
