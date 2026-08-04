import fs from "fs";
import path from "path";

interface MailInput {
  to: string;
  subject: string;
  html: string;
}

const devMailDir = path.join(process.cwd(), ".devmail");

// No transactional email provider is configured yet. This writes each email to disk and
// logs it instead of sending it, so reset links are reachable during development. Swap
// the body of this function for a real provider (Resend/SendGrid/SES) call once a
// provider API key exists — every caller of sendMail stays unchanged.
export async function sendMail({ to, subject, html }: MailInput): Promise<void> {
  console.log(`[mailer] (dev mode, not actually sent) To: ${to} | Subject: ${subject}`);

  fs.mkdirSync(devMailDir, { recursive: true });
  const filename = `${Date.now()}-${to.replace(/[^a-z0-9]/gi, "_")}.html`;
  fs.writeFileSync(
    path.join(devMailDir, filename),
    `<!-- To: ${to} -->\n<!-- Subject: ${subject} -->\n${html}`,
  );
  console.log(`[mailer] preview written to apps/api/.devmail/${filename}`);
}
