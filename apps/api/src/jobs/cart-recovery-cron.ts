import cron from "node-cron";
import { runCartRecoverySweep } from "../modules/cart/cart-recovery.service";

/** Runs every 15 minutes, sweeping for real carts abandoned past the threshold and emailing
 * (via the dev-mode mailer stub until a real provider is connected) a real recovery message. */
export function startCartRecoveryCron() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const sent = await runCartRecoverySweep();
      if (sent > 0) console.log(`[cart-recovery-cron] sent ${sent} recovery email(s)`);
    } catch (err) {
      console.error("[cart-recovery-cron] failed:", err);
    }
  });
}
