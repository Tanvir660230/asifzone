import cron from "node-cron";
import { syncFlashSaleActivation } from "../modules/flash-sales/flash-sale.service";

/** Runs every minute so a scheduled flash sale goes live/ends on time without a manual admin toggle or a redeploy. */
export function startFlashSaleCron() {
  cron.schedule("* * * * *", async () => {
    try {
      const changed = await syncFlashSaleActivation();
      if (changed > 0) console.log(`[flash-sale-cron] activation changed for ${changed} sale(s)`);
    } catch (err) {
      console.error("[flash-sale-cron] failed:", err);
    }
  });
}
