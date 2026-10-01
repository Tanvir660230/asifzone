import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { startFlashSaleCron } from "./jobs/flash-sale-cron";
import { startCampaignSendWorker } from "./jobs/campaign-send-worker";
import { startCampaignSchedulerCron } from "./jobs/campaign-scheduler-cron";
import { startCourierStatusCron } from "./jobs/courier-status-cron";
import { startPaymentReconciliationCron } from "./jobs/payment-reconciliation-cron";
import { startMetaCapiWorker } from "./jobs/meta-capi-worker";
import { startOutboxWorker } from "./jobs/outbox-worker";
import { syncFlashSaleActivation } from "./modules/flash-sales/flash-sale.service";
import { installNetworkGuard, liveProvidersEnabled } from "./lib/provider-guard";
import { logger } from "./lib/observability/logger";
import { captureError } from "./lib/observability/error-capture";

let shuttingDown = false;

async function main() {
  await prisma.$connect();
  await redis.connect().catch((err) => logger.warn("[redis] not connected yet:", { detail: err.message }));

  await syncFlashSaleActivation().catch((err) => captureError(err, { msg: "[flash-sale-cron] initial sync failed:" }));

  // e2e / local safety (Phase 9): with LIVE_PROVIDERS=off no outbound request may leave for a real provider.
  if (!liveProvidersEnabled()) {
    installNetworkGuard([new URL(env.webInternalUrl).hostname]);
    logger.info("[provider-guard] live providers OFF — outbound requests to non-local hosts are blocked");
  }

  const server = app.listen(env.port, () => {
    logger.info(`API listening on http://localhost:${env.port}`);
  });

  // BullMQ-backed schedulers need Redis; wired up after listen (not awaited) so a temporarily
  // unreachable Redis never blocks the API from serving requests.
  startFlashSaleCron().catch((err) => captureError(err, { msg: "[flash-sale-cron] failed to start:" }));
  startCampaignSendWorker().catch((err) => captureError(err, { msg: "[campaign-send-worker] failed to start:" }));
  startCampaignSchedulerCron().catch((err) => captureError(err, { msg: "[campaign-scheduler-cron] failed to start:" }));
  startCourierStatusCron().catch((err) => captureError(err, { msg: "[courier-status-cron] failed to start:" }));
  startPaymentReconciliationCron().catch((err) => captureError(err, { msg: "[payment-reconciliation-cron] failed to start:" }));
  startMetaCapiWorker().catch((err) => captureError(err, { msg: "[meta-capi] worker failed to start:" }));
  startOutboxWorker().catch((err) => captureError(err, { msg: "[outbox] worker failed to start:" }));

  // Stop accepting new connections and let in-flight requests finish before tearing down Prisma —
  // without this, a deploy's SIGTERM could cut a request off mid-response instead of draining it.
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[server] ${signal} received, shutting down...`);

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
  captureError(err, { msg: "Failed to start server:" });
  process.exit(1);
});

// A rejection/exception outside the request lifecycle (e.g. a cron tick, a fire-and-forget
// notification) has nowhere else to go — without this it's either a silent failure (rejection) or
// an untraced hard crash (exception). Logged and exited deliberately rather than left to Node's
// default handling, which for uncaughtException is "crash with a raw stack trace and no context".
process.on("unhandledRejection", (reason) => {
  captureError(reason, { msg: "[unhandledRejection]" });
});

process.on("uncaughtException", (err) => {
  captureError(err, { msg: "[uncaughtException]" });
  process.exit(1);
});
