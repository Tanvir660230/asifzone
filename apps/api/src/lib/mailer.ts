import fs from "fs";
import path from "path";
import { Resend } from "resend";
import { env } from "../config/env";
import { liveProvidersEnabled } from "./provider-guard";

interface MailInput {
  to: string;
  subject: string;
  html: string;
  /** Provider-side deduplication (Resend keeps it 24 h): a repeat send with the same key is not delivered twice. */
  idempotencyKey?: string;
}

/** A failed send; `retryable` is false when the provider rejected the request itself (validation, domain, credentials). */
export class MailProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MailProviderError";
  }
}

const devMailDir = path.join(process.cwd(), ".devmail");
/** Inside the outbox lease (Phase 9 D-5). The SDK takes no signal, so the send is raced against a timer: a late delivery of
 * the abandoned attempt is deduplicated by the provider's idempotency key on the retry. */
export const MAIL_TIMEOUT_MS = 20_000;
const resend = !env.resend.apiKey || !liveProvidersEnabled() ? null : new Resend(env.resend.apiKey);

function writeDevMail({ to, subject, html }: MailInput) {
  console.log(`[mailer] (dev mode, not actually sent) To: ${to} | Subject: ${subject}`);

  fs.mkdirSync(devMailDir, { recursive: true });
  const filename = `${Date.now()}-${to.replace(/[^a-z0-9]/gi, "_")}.html`;
  fs.writeFileSync(
    path.join(devMailDir, filename),
    `<!-- To: ${to} -->\n<!-- Subject: ${subject} -->\n${html}`,
  );
  console.log(`[mailer] preview written to apps/api/.devmail/${filename}`);
}

// No RESEND_API_KEY configured yet: fall back to writing each email to disk and logging it, so
// reset links stay reachable during local dev/CI without a real provider account.
export async function sendMail({ to, subject, html, idempotencyKey }: MailInput): Promise<void> {
  if (!resend) {
    writeDevMail({ to, subject, html });
    return;
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailProviderError(`[mailer] Resend send timed out after ${MAIL_TIMEOUT_MS} ms`, true)), MAIL_TIMEOUT_MS);
  });
  const { error } = await Promise.race([
    resend.emails.send({ from: env.resend.fromAddress, to, subject, html }, idempotencyKey ? { idempotencyKey } : undefined),
    timeout,
  ]).finally(() => clearTimeout(timer));
  if (error) {
    const status = (error as { statusCode?: number | null }).statusCode ?? null;
    // No status (network) / 429 / 5xx are transient; any other 4xx is the request itself being rejected.
    throw new MailProviderError(`[mailer] Resend send failed: ${error.message}`, status === null || status === 429 || status >= 500);
  }
}
