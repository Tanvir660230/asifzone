import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { env } from "../../config/env";
import { constantTimeEqual } from "../../lib/token-hash";
import { handleSteadfastWebhook } from "./courier.service";
import { captureError } from "../../lib/observability/error-capture";
import { getProviders } from "../../providers/registry";

export const balance = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ balance: await getProviders().courier.balance() });
});

/** Steadfast's webhook (Notify / Callback URL). Authenticated by a shared secret of our own choosing
 * (env.steadfast.webhookToken / .env.example): in the query string (`?token=`, the original setup) or as the panel's
 * "Auth token", which Steadfast sends as `Authorization: Bearer <token>`. Always responds 200 once the token check
 * passes — there is nothing the caller can usefully do with a failure response (see handleSteadfastWebhook's own
 * re-verification step for how the actual trust decision is made). */
export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const header = req.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const expected = env.steadfast.webhookToken;
  if (!expected || !(constantTimeEqual(queryToken, expected) || constantTimeEqual(bearer, expected))) {
    return res.status(401).json({ error: "Invalid webhook token" });
  }

  try {
    await handleSteadfastWebhook(req.body, { idempotencyKey: req.get("idempotency-key") ?? null });
  } catch (err) {
    // Steadfast doesn't retry non-2xx responses, so letting this throw would drop the status push
    // outright — log and still 200 as documented above; syncPendingCourierStatuses' 15-min sweep
    // (jobs/courier-status-cron.ts) is the backstop that catches it from here.
    captureError(err, { msg: "[steadfast-webhook] failed to process:" });
  }
  res.status(200).json({ received: true });
});
