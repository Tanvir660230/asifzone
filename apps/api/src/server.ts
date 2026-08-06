import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { startFlashSaleCron } from "./jobs/flash-sale-cron";
import { startCartRecoveryCron } from "./jobs/cart-recovery-cron";
import { startCampaignSendWorker } from "./jobs/campaign-send-worker";
import { startCampaignSchedulerCron } from "./jobs/campaign-scheduler-cron";
import { syncFlashSaleActivation } from "./modules/flash-sales/flash-sale.service";

async function main() {
  await prisma.$connect();
  await redis.connect().catch((err) => console.warn("[redis] not connected yet:", err.message));

  await syncFlashSaleActivation().catch((err) => console.error("[flash-sale-cron] initial sync failed:", err));

  app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });

  // BullMQ-backed schedulers need Redis; wired up after listen (not awaited) so a temporarily
  // unreachable Redis never blocks the API from serving requests.
  startFlashSaleCron().catch((err) => console.error("[flash-sale-cron] failed to start:", err));
  startCartRecoveryCron().catch((err) => console.error("[cart-recovery-cron] failed to start:", err));
  startCampaignSendWorker().catch((err) => console.error("[campaign-send-worker] failed to start:", err));
  startCampaignSchedulerCron().catch((err) => console.error("[campaign-scheduler-cron] failed to start:", err));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
