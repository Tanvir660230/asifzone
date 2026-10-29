/**
 * E2E fixture (Order Operations phase 4): mark orders as booked with a courier, the way a real booking leaves them —
 * a consignment id, our label barcode, booked now, Confirmed → Packed → Shipped through the order state machine. The
 * end-to-end tests can't book with the real courier (live providers are off), and the scanning pages only take booked
 * parcels. Test database only:
 *
 *   tsx scripts/with-test-db.ts npx tsx scripts/e2e/mark-booked.ts <orderId> [...]
 *
 * Prints {"<orderId>": "<label barcode>"} as JSON.
 */
import { prisma } from "../../src/config/prisma";
import { changeOrderStatus } from "../../src/modules/orders/order.service";

async function main() {
  const db = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  // CI's e2e job runs on GitHub's hosted runner against its own throwaway database (named clothing_brand) — never the
  // self-hosted VPS runner, which reports RUNNER_ENVIRONMENT=self-hosted.
  const ciThrowaway = process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted";
  if (db !== "clothing_brand_test" && !ciThrowaway) throw new Error(`mark-booked refuses database "${db}" — run it through scripts/with-test-db.ts`);
  const out: Record<string, string> = {};
  for (const id of process.argv.slice(2)) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (order.status === "PENDING") await changeOrderStatus(id, { status: "CONFIRMED", note: "E2E fixture" });
    const code = order.trackingNumber ?? `E2E${id.slice(-10).toUpperCase()}`;
    await prisma.order.update({ where: { id }, data: { trackingNumber: code, courierConsignmentId: `e2e-${id}`, courierBookedAt: new Date() } });
    const now = await prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (["CONFIRMED", "PROCESSING"].includes(now.status)) await changeOrderStatus(id, { status: "PACKED", note: "E2E fixture" });
    if (["CONFIRMED", "PROCESSING", "PACKED"].includes(now.status)) await changeOrderStatus(id, { status: "SHIPPED", note: "E2E fixture: booked" });
    out[id] = code;
  }
  console.log(JSON.stringify(out));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().then(() => process.exit()));
