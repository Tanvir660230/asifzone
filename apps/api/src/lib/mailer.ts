import fs from "fs";
import path from "path";
import { Resend } from "resend";
import { env } from "../config/env";

interface MailInput {
  to: string;
  subject: string;
  html: string;
}

const devMailDir = path.join(process.cwd(), ".devmail");
const resend = env.resend.apiKey ? new Resend(env.resend.apiKey) : null;

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
export async function sendMail({ to, subject, html }: MailInput): Promise<void> {
  if (!resend) {
    writeDevMail({ to, subject, html });
    return;
  }

  const { error } = await resend.emails.send({
    from: env.resend.fromAddress,
    to,
    subject,
    html,
  });
  if (error) throw new Error(`[mailer] Resend send failed: ${error.message}`);
}
