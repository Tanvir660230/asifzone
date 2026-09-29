/**
 * Rebuilds every ProductReadModel row from the canonical pricing engine (docs/STOREFRONT_READ_MODEL.md §5). Run once
 * after deploying the Phase 3 migration, and any time the drift report shows a mismatch. Idempotent; safe to re-run.
 *   pnpm --filter api read-model:rebuild
 */
import "../src/config/env";
import { prisma } from "../src/config/prisma";
import { rebuildAllReadModels, readModelDrift } from "../src/domain/storefront/read-model.service";

(async () => {
  const rebuilt = await rebuildAllReadModels();
  const drift = await readModelDrift();
  console.log(`[read-model] rebuilt ${rebuilt} row(s); drift after rebuild: ${drift.length}`);
  await prisma.$disconnect();
  process.exit(drift.length ? 1 : 0);
})().catch(async (err) => {
  console.error("[read-model] rebuild failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
