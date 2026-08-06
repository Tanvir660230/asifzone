import { Worker } from "bullmq";
import { queueConnection } from "../lib/queue";
import { CAMPAIGN_SEND_QUEUE, processCampaignSend } from "../modules/campaigns/campaign.service";

/** Processes campaign sends enqueued by campaign.service.queueCampaignSend — one job per
 * campaign, fanning out to every PENDING CampaignRecipient inside processCampaignSend. */
export async function startCampaignSendWorker() {
  new Worker(
    CAMPAIGN_SEND_QUEUE,
    async (job) => {
      await processCampaignSend(job.data.campaignId as string);
    },
    { connection: queueConnection },
  );
}
