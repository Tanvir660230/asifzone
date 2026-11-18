import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { storeContext } from "../domain/metrics/store-time";
import { sendPeriodReport } from "../modules/targets/period-report.service";
import { DAILY_RETRY, DAILY_SCHEDULES, repeatFor } from "./daily-schedules";

const QUEUE_NAME = "period-report";

/** The weekly (Saturday) and monthly (the 1st) business reports by SMS — each only when the owner switched it on in SMS
 * notifications; sendPeriodReport sends once per store day however often it runs, so a failed run is simply retried. */
export async function startPeriodReportCron() {
  const queue = createQueue(QUEUE_NAME);
  createObservedWorker(
    QUEUE_NAME,
    async (job) => {
      await sendPeriodReport(job.name === "monthly" ? "month" : "week");
    },
    { connection: queueConnection },
  );
  const { timezone } = await storeContext();
  await queue.upsertJobScheduler("weekly-report", repeatFor(DAILY_SCHEDULES.weeklyReport, timezone), { name: "weekly", opts: DAILY_RETRY });
  await queue.upsertJobScheduler("monthly-report", repeatFor(DAILY_SCHEDULES.monthlyReport, timezone), { name: "monthly", opts: DAILY_RETRY });
}
