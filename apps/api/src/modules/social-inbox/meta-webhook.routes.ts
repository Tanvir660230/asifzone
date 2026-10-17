import { createHmac } from "node:crypto";
import { Router, type Request } from "express";
import { env } from "../../config/env";
import { asyncHandler } from "../../lib/async-handler";
import { constantTimeEqual } from "../../lib/token-hash";
import { captureError } from "../../lib/observability/error-capture";
import { parseMetaWebhook } from "./meta-webhook.parse";
import { ingestInbound } from "./ingest.service";

export const META_WEBHOOK_PATH = "/api/v1/webhooks/meta";

/** A request whose JSON body was also kept as the exact bytes received (app.ts keeps them for this path only). */
export type RawBodyRequest = Request & { rawBody?: Buffer };

/** Meta's X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the raw body with the app secret. */
export function validMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !rawBody || !header) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(header, expected);
}

/**
 * One webhook for WhatsApp, Messenger, Instagram and Page comments (Social Inbox). Public by necessity; trusted only
 * through Meta's signature, so an unsigned or wrongly signed call stores nothing. No cookies ride along, so the CSRF
 * check never applies, and there is no rate limit: Meta's own retry storms must not be turned away.
 */
export const metaWebhookRouter = Router();

/** The subscription handshake Meta runs when the webhook URL is saved in the app dashboard. */
metaWebhookRouter.get("/", (req, res) => {
  const token = typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : "";
  const expected = env.metaInbox.webhookVerifyToken;
  if (req.query["hub.mode"] === "subscribe" && expected && constantTimeEqual(token, expected)) {
    res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
    return;
  }
  res.status(403).json({ error: "Verification failed" });
});

metaWebhookRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!validMetaSignature((req as RawBodyRequest).rawBody, req.get("x-hub-signature-256"), env.metaInbox.appSecret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    try {
      await ingestInbound(parseMetaWebhook(req.body, { pageId: env.metaInbox.pageId, igAccountId: env.metaInbox.igAccountId }));
    } catch (err) {
      // Meta retries a non-2xx for hours and then disables the subscription; a failure here is ours to fix, not theirs
      // to repeat. It is reported, and the customer's message is still in WhatsApp / the Page inbox.
      captureError(err, { msg: "[meta-webhook] failed to store:" });
    }
    res.status(200).json({ received: true });
  }),
);
