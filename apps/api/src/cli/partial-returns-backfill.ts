/**
 * Partial-delivery return values (docs/PAYMENT_LEDGER.md §5c). Partial deliveries reconciled before this release kept
 * no value on their return record, so the ledger still charged the whole order ("Still due" = the full total). This
 * values what came back with the order's own pricing and refreshes the payment projection. Dry run by default; run
 * once after deploying.
 *   pnpm --filter api partial-returns:backfill            # report only
 *   pnpm --filter api partial-returns:backfill --apply    # write the values
 * In production it is compiled into the api image: `node dist/cli/partial-returns-backfill.js [--apply]`.
 */
import "../config/env";
import { prisma } from "../config/prisma";
import { backfillPartialDeliveryReturns } from "../modules/orders/order.service";

// Operator output goes straight to the terminal (stdout for the report, stderr for a failure) — not the JSON logger.
const say = (line: string) => process.stdout.write(`${line}\n`);

(async () => {
  const apply = process.argv.includes("--apply");
  const result = await backfillPartialDeliveryReturns({ apply });
  say(`[partial-returns] ${result.checked} partial-delivery return(s) without values; ${apply ? "valued" : "would value"} ${result.rows.length}:`);
  for (const r of result.rows) {
    say(`  ${r.orderNumber}  ${r.value.toFixed(2)} came back${r.keptNothing && r.status === "PARTIALLY_DELIVERED" ? "  — customer kept nothing: mark this order Returned" : ""}`);
  }
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (err) => {
  process.stderr.write(`[partial-returns] backfill failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
