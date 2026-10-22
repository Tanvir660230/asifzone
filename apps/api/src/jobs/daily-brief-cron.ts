import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { storeContext } from "../domain/metrics/store-time";
import { sendMorningBrief } from "../modules/analytics/anomalies.service";

const QUEUE_NAME = "daily-brief";

/** Smart Analytics §4.9: at 09:00 in the store's timezone, yesterday's brief (orders against the usual weekday, parcels,
 * money in, best channel, anomalies and the queues to work) lands in the admin bell. */
export async function startDailyBriefCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      await sendMorningBrief();
    },
    { connection: queueConnection },
  );

  const { timezone } = await storeContext();
  await queue.upsertJobScheduler("daily-brief", { pattern: "0 9 * * *", tz: timezone }, { name: "brief" });
}
