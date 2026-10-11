/**
 * Payment ledger reconciliation (docs/PAYMENT_LEDGER.md §12). Reports every order whose stored paymentStatus differs
 * from its ledger (PL-1) and every rule violation (PL-2, PL-5). Dry run by default; `--apply` rewrites only the
 * Order.paymentStatus projection (never an order status, never a money row). Run once after deploying the Phase 4
 * migrations, and any time the drift report is non-empty.
 *   pnpm --filter api payment-ledger:reconcile            # report only
 *   pnpm --filter api payment-ledger:reconcile --apply    # repair the projection
 */
import "../src/config/env";
import { prisma } from "../src/config/prisma";
import { repairPaymentLedger } from "../src/domain/payments/payment-ledger.service";

(async () => {
  const apply = process.argv.includes("--apply");
  const result = await repairPaymentLedger({ apply });
  console.log(`[payment-ledger] checked ${result.checked} order(s); ${apply ? "repaired" : "would repair"} ${result.changed.length}:`);
  for (const row of result.changed) console.log(`  ${row.orderNumber}  ${row.stored} → ${row.derived}`);
  if (result.violations.length) {
    console.log(`[payment-ledger] ${result.violations.length} violation(s) need a person (never auto-repaired):`);
    for (const v of result.violations) console.log(`  ${v.orderNumber}  ${v.rule}: ${v.detail}`);
  }
  await prisma.$disconnect();
  process.exit(result.violations.length || (!apply && result.changed.length) ? 1 : 0);
})().catch(async (err) => {
  console.error("[payment-ledger] reconcile failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
