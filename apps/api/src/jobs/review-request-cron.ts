import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { storeContext } from "../domain/metrics/store-time";
import { sendReviewRequests } from "../modules/reviews/review-request";
import { DAILY_RETRY, DAILY_SCHEDULES, repeatFor } from "./daily-schedules";

const QUEUE_NAME = "review-requests";

/** Once a day (jobs/daily-schedules.ts), the review-request SMS to customers whose order was delivered two days ago —
 * only when the store switched it on. Each order is claimed before its SMS, so a retried run never texts twice. */
export async function startReviewRequestCron() {
  const queue = createQueue(QUEUE_NAME);
  createObservedWorker(
    QUEUE_NAME,
    async () => {
      await sendReviewRequests();
    },
    { connection: queueConnection },
  );
  const { timezone } = await storeContext();
  await queue.upsertJobScheduler("review-requests", repeatFor(DAILY_SCHEDULES.reviewRequests, timezone), { name: "review-requests", opts: DAILY_RETRY });
}
