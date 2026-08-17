import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { env } from "../../config/env";
import { constantTimeEqual } from "../../lib/token-hash";
import { getSteadfastBalance } from "../../lib/steadfast";
import { handleSteadfastWebhook } from "./courier.service";

interface SteadfastWebhookBody {
  consignment_id?: number | string;
}

export const balance = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ balance: await getSteadfastBalance() });
});

/** Steadfast's Notify URL callback. No signature — authenticated only by a shared secret of our
 * own choosing in the query string (see env.steadfast.webhookToken / .env.example). Always
 * responds 200 once the token check passes: Steadfast doesn't retry on a non-2xx, and there is
 * nothing the caller can usefully do with a failure response anyway (see handleSteadfastWebhook's
 * own re-verification step for how the actual trust decision is made). */
export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!env.steadfast.webhookToken || !constantTimeEqual(token, env.steadfast.webhookToken)) {
    return res.status(401).json({ error: "Invalid webhook token" });
  }

  try {
    await handleSteadfastWebhook(req.body as SteadfastWebhookBody);
  } catch (err) {
    // Steadfast doesn't retry non-2xx responses, so letting this throw would drop the status push
    // outright — log and still 200 as documented above; syncPendingCourierStatuses' 15-min sweep
    // (jobs/courier-status-cron.ts) is the backstop that catches it from here.
    console.error("[steadfast-webhook] failed to process:", err);
  }
  res.status(200).json({ received: true });
});
