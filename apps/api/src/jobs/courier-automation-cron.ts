import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { storeContext } from "../domain/metrics/store-time";
import { runCourierAutomation } from "../modules/parcel-scans/courier-automation.service";
import { DAILY_RETRY, DAILY_SCHEDULES, repeatFor } from "./daily-schedules";

const QUEUE_NAME = "courier-automation";

/** Order Operations phase 5: at 08:23 store time (jobs/daily-schedules.ts), the daily courier check — stuck parcels, overdue returns, today's
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
  // Idempotent per store day (one row, one bell alert), so a failed run is retried a few minutes later.
  await queue.upsertJobScheduler("courier-automation", repeatFor(DAILY_SCHEDULES.courierAutomation, timezone), { name: "check", opts: DAILY_RETRY });
}
