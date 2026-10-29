import { prisma } from "../../src/config/prisma";
import { adjustVariantStock } from "../../src/modules/inventory/inventory.service";

/** Test database only (run through scripts/with-test-db.ts): tops the seeded DEMO-* variants back up to `--to` units (default
 * 50) through the normal stock adjustment, so the ledger stays whole. Long e2e runs use up the seed's stock. */
async function main() {
  const i = process.argv.indexOf("--to");
  const to = i > 0 ? Number(process.argv[i + 1]) : 50;
  const owner = await prisma.adminUser.findFirstOrThrow({ where: { role: "OWNER", isActive: true }, select: { id: true } });
  const variants = await prisma.productVariant.findMany({ where: { sku: { startsWith: "DEMO-" } }, select: { id: true, sku: true, stock: true } });
  for (const v of variants) {
    if (v.stock >= to) continue;
    await adjustVariantStock(v.id, to - v.stock, "RESTOCK", owner.id, "e2e fixture top-up (test database)");
    console.log(`${v.sku}: ${v.stock} → ${to}`);
  }
  await prisma.$disconnect();
  process.exit(0);
}
void main();
