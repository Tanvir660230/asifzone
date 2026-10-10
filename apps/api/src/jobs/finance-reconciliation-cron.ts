import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { scheduledReconciliation } from "../domain/finance/reconciliation.service";
import { logger } from "../lib/observability/logger";

const QUEUE_NAME = "finance-reconciliation";

/** Financial Core (docs/FINANCE_PHASE_1.md §9): runs every reconciliation check once a day (03:30 server time) via a
 * BullMQ repeatable job — dashboard revenue/COGS vs the ledger, ledger integrity, unposted events, cost completeness.
 * Every run is kept (ReconciliationRun); a difference is logged as a warning. A no-op until the books have an opening date. */
export async function startFinanceReconciliationCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const { ran, differences } = await scheduledReconciliation();
      if (ran) logger.info(`[finance-reconciliation-cron] ran all checks: ${differences} difference(s)`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("finance-reconciliation", { pattern: "30 3 * * *" }, { name: "reconcile" });
}
