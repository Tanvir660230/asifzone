import { createObservedWorker } from "../lib/observability/jobs";
import { createQueue, queueConnection } from "../lib/queue";
import { syncCommerce } from "../domain/finance/commerce-accounting.service";
import { logger } from "../lib/observability/logger";

const QUEUE_NAME = "finance-commerce-sync";

/** Financial Core Phase 3 (docs/FINANCE_PHASE_3.md §2): every 5 minutes the commerce projector brings orders whose facts
 * changed (payments, deliveries, refunds, returns, store credit) into the books. Idempotent and serialised per business;
 * a no-op until the books have an opening date. Commerce itself is never touched. */
export async function startFinanceCommerceSyncCron() {
  const queue = createQueue(QUEUE_NAME);

  createObservedWorker(
    QUEUE_NAME,
    async () => {
      const stats = await syncCommerce();
      if (stats.skipped && stats.skipped !== "OPENING_DATE_NOT_SET") logger.warn(`[finance-commerce-sync] skipped: ${stats.skipped}${stats.missingMappings ? ` (${stats.missingMappings.join(", ")})` : ""}`);
      else if (stats.recorded) logger.info(`[finance-commerce-sync] ${stats.orders} order(s): ${stats.recorded} event(s) recorded, ${stats.posted} posted, ${stats.failed} failed`);
    },
    { connection: queueConnection },
  );

  await queue.upsertJobScheduler("finance-commerce-sync", { pattern: "*/5 * * * *" }, { name: "sync" });
}
