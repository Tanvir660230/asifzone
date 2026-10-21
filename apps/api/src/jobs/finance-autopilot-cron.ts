import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { runAutopilot } from "../domain/finance/autopilot.service";
import { logger } from "../lib/observability/logger";

const QUEUE_NAME = "finance-autopilot";

/** Owner's books §15 (docs/FINANCE_OWNER_BOOKS.md): twice a day (06:00 and 18:00 server time) brings in Steadfast payouts,
 * books the ones the owner keeps as his drawings, reads Meta's spend and shares finished months with partners — each only
 * when switched on in Finance › Setup › Autopilot. Idempotent; a step that fails is kept in the run for the page. */
export async function startFinanceAutopilotCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const run = await runAutopilot();
      const failed = Object.entries(run).filter(([, s]) => typeof s === "object" && s && !(s as { ok: boolean }).ok);
      if (failed.length) logger.warn(`[finance-autopilot] ${failed.map(([k, s]) => `${k}: ${(s as { error?: string }).error}`).join(" · ")}`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("finance-autopilot", { pattern: "0 6,18 * * *" }, { name: "autopilot" });
}
