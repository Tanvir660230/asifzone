import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { env } from "../../config/env";
import { constantTimeEqual } from "../../lib/token-hash";
import { handleSteadfastWebhook } from "./courier.service";

interface SteadfastWebhookBody {
  consignment_id?: number | string;
}

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

  await handleSteadfastWebhook(req.body as SteadfastWebhookBody);
  res.status(200).json({ received: true });
});
