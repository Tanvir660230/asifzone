import webpush from "web-push";
import { env } from "../config/env";

const vapidConfigured = Boolean(env.webPush.publicKey && env.webPush.privateKey);

if (vapidConfigured) {
  webpush.setVapidDetails(
    `mailto:${env.webPush.contactEmail}`,
    env.webPush.publicKey,
    env.webPush.privateKey,
  );
}

interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushInput {
  subscription: PushSubscriptionKeys;
  title: string;
  body: string;
  url?: string;
}

// No WEB_PUSH_* VAPID keys configured yet (generate with `npx web-push generate-vapid-keys`):
// log instead of sending, same fallback spirit as lib/mailer.ts and lib/sms.ts.
export async function sendPush({ subscription, title, body, url }: PushInput): Promise<void> {
  if (!vapidConfigured) {
    console.log(`[push] (dev mode, not actually sent) To: ${subscription.endpoint} | ${title}`);
    return;
  }

  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify({ title, body, url }),
  );
}
