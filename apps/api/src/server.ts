import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { startFlashSaleCron } from "./jobs/flash-sale-cron";
import { startCampaignSendWorker } from "./jobs/campaign-send-worker";
import { startCampaignSchedulerCron } from "./jobs/campaign-scheduler-cron";
import { startCourierStatusCron } from "./jobs/courier-status-cron";
import { syncFlashSaleActivation } from "./modules/flash-sales/flash-sale.service";

let shuttingDown = false;

async function main() {
  await prisma.$connect();
  await redis.connect().catch((err) => console.warn("[redis] not connected yet:", err.message));

  await syncFlashSaleActivation().catch((err) => console.error("[flash-sale-cron] initial sync failed:", err));

  const server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });

  // BullMQ-backed schedulers need Redis; wired up after listen (not awaited) so a temporarily
  // unreachable Redis never blocks the API from serving requests.
  startFlashSaleCron().catch((err) => console.error("[flash-sale-cron] failed to start:", err));
  startCampaignSendWorker().catch((err) => console.error("[campaign-send-worker] failed to start:", err));
  startCampaignSchedulerCron().catch((err) => console.error("[campaign-scheduler-cron] failed to start:", err));
  startCourierStatusCron().catch((err) => console.error("[courier-status-cron] failed to start:", err));

  // Stop accepting new connections and let in-flight requests finish before tearing down Prisma —
  // without this, a deploy's SIGTERM could cut a request off mid-response instead of draining it.
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down...`);

    const closeServer = new Promise<void>((resolve) => server.close(() => resolve()));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([closeServer, timeout]);

    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// A rejection/exception outside the request lifecycle (e.g. a cron tick, a fire-and-forget
// notification) has nowhere else to go — without this it's either a silent failure (rejection) or
// an untraced hard crash (exception). Logged and exited deliberately rather than left to Node's
// default handling, which for uncaughtException is "crash with a raw stack trace and no context".
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});
