import { env } from "../../config/env";
import { constantTimeEqual, signPayload } from "../../lib/token-hash";

/** The signed code in an incomplete order's resume link: `<leadId>.<12-char HMAC>` — not guessable for another lead,
 * and needing no table (same pattern as the self-confirm link, orders/self-confirm-code.ts). */
const SIG_LENGTH = 12;
const secret = () => process.env.ORDER_LINK_SECRET || env.jwtAccessSecret;
const sign = (id: string) => Buffer.from(signPayload(`checkout-lead:${id}`, secret()), "hex").toString("base64url").slice(0, SIG_LENGTH);

export function checkoutLeadCode(id: string): string {
  return `${id}.${sign(id)}`;
}

/** The lead a code is for, or null when the signature doesn't match. */
export function parseCheckoutLeadCode(code: string): string | null {
  const dot = code.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  if (sig.length !== SIG_LENGTH) return null;
  return constantTimeEqual(sig, sign(id)) ? id : null;
}
