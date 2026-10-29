import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { storeContext } from "../domain/metrics/store-time";
import { runCourierAutomation } from "../modules/parcel-scans/courier-automation.service";

const QUEUE_NAME = "courier-automation";

/** Order Operations phase 5: at 08:30 store time, the daily courier check — stuck parcels, overdue returns, today's
 * unscanned bookings, the payout evidence sync — recorded for the Dispatch / Returns pages and one bell alert. Read-only
 * towards orders, stock and money (modules/parcel-scans/courier-automation.service.ts). Same pattern as daily-brief-cron. */
export async function startCourierAutomationCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      await runCourierAutomation();
    },
    { connection: queueConnection },
  );

  const { timezone } = await storeContext();
  await queue.upsertJobScheduler("courier-automation", { pattern: "30 8 * * *", tz: timezone }, { name: "check" });
}
