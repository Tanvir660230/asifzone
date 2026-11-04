import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { storeContext } from "../domain/metrics/store-time";
import { sendMorningBrief } from "../modules/analytics/anomalies.service";
import { DAILY_RETRY, DAILY_SCHEDULES, repeatFor } from "./daily-schedules";

const QUEUE_NAME = "daily-brief";

/** Smart Analytics §4.9: at 09:07 in the store's timezone (jobs/daily-schedules.ts), yesterday's brief (orders against the usual weekday, parcels,
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
  // sendMorningBrief sends one brief per day however often it runs, so a failed run is retried a few minutes later.
  await queue.upsertJobScheduler("daily-brief", repeatFor(DAILY_SCHEDULES.dailyBrief, timezone), { name: "brief", opts: DAILY_RETRY });
}
