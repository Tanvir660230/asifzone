import { env } from "../../config/env";
import { constantTimeEqual, signPayload } from "../../lib/token-hash";

/** The signed code in the customer's confirm-your-order link: `<orderNumber>.<10-char HMAC>` — short enough for an SMS,
 * not guessable for another order, and needing no table. Kept apart from self-confirm.ts so the SMS code can import it
 * without pulling in the order service. */
const SIG_LENGTH = 10;
const secret = () => process.env.ORDER_LINK_SECRET || env.jwtAccessSecret;
const sign = (orderNumber: string) => Buffer.from(signPayload(`self-confirm:${orderNumber}`, secret()), "hex").toString("base64url").slice(0, SIG_LENGTH);

export function selfConfirmCode(orderNumber: string): string {
  return `${orderNumber}.${sign(orderNumber)}`;
}

/** The order number a code is for, or null when the signature doesn't match. */
export function parseSelfConfirmCode(code: string): string | null {
  const dot = code.lastIndexOf(".");
  if (dot <= 0) return null;
  const orderNumber = code.slice(0, dot);
  const sig = code.slice(dot + 1);
  if (sig.length !== SIG_LENGTH) return null;
  return constantTimeEqual(sig, sign(orderNumber)) ? orderNumber : null;
}

/** After the link goes out, the order waits this long in Call later before anyone calls: most customers who will confirm
 * do it within minutes, and every one of them is a call (and its cost) saved. Unconfirmed, it comes up in Call now. */
export const SELF_CONFIRM_WAIT_MINUTES = 120;
