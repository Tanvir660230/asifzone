import webpush from "web-push";
import { env } from "../../config/env";
import { logger } from "../../lib/observability/logger";

const vapidConfigured = Boolean(env.webPush.publicKey && env.webPush.privateKey);

if (vapidConfigured) {
  webpush.setVapidDetails(
    `mailto:${env.webPush.contactEmail}`,
    env.webPush.publicKey,
    env.webPush.privateKey,
  );
}

/** Phase 12 W6 (contract P-3): a push send is bounded. web-push's own `timeout` option is only a socket-idle timeout, so the
 * total is bounded with the same Promise.race pattern providers/email/resend.ts uses. Push is best-effort marketing, so
 * 10 s (shorter than the 20 s transactional providers) is enough. */
export const PUSH_TIMEOUT_MS = 10_000;

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushInput {
  subscription: PushSubscriptionKeys;
  title: string;
  body: string;
  url?: string;
}

// No WEB_PUSH_* VAPID keys configured yet (generate with `npx web-push generate-vapid-keys`):
// log instead of sending, same fallback spirit as providers/email/resend.ts and providers/sms/bulksmsbd.ts.
export async function sendPush({ subscription, title, body, url }: PushInput): Promise<void> {
  if (!vapidConfigured) {
    logger.info(`[push] (dev mode, not actually sent) To: ${subscription.endpoint} | ${title}`);
    return;
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`[push] send timed out after ${PUSH_TIMEOUT_MS} ms`);
      err.name = "TimeoutError";
      reject(err);
    }, PUSH_TIMEOUT_MS);
  });
  await Promise.race([
    webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({ title, body, url }),
      { timeout: PUSH_TIMEOUT_MS },
    ),
    timeout,
  ]).finally(() => clearTimeout(timer));
}
