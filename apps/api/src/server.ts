import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { startFlashSaleCron } from "./jobs/flash-sale-cron";
import { startCartRecoveryCron } from "./jobs/cart-recovery-cron";
import { syncFlashSaleActivation } from "./modules/flash-sales/flash-sale.service";

async function main() {
  await prisma.$connect();
  await redis.connect().catch((err) => console.warn("[redis] not connected yet:", err.message));

  await syncFlashSaleActivation().catch((err) => console.error("[flash-sale-cron] initial sync failed:", err));
  startFlashSaleCron();
  startCartRecoveryCron();

  app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
