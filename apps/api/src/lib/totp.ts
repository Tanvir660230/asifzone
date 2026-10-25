import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time codes (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps), the scheme every authenticator app
 * (Google Authenticator, Microsoft Authenticator, 1Password, Authy) understands. Used for the admin console's 2-step
 * sign-in. Plain node:crypto — no dependency for a 30-line algorithm.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_MS = 30_000;
const DIGITS = 6;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Case and spaces don't matter (apps show the key in groups); padding is ignored. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (RFC 4226's recommended length), base32 as apps expect it. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code an app shows at `timeMs`. */
export function totpAt(secret: string, timeMs: number = Date.now()): string {
  return codeForStep(secret, Math.floor(timeMs / STEP_MS));
}

/** The step the typed code belongs to — the current one or one either side, for a phone clock a little off — or null.
 * The caller stores the step and refuses it (and older ones) next time, so a code can't be used twice. */
export function verifyTotp(secret: string, typed: string, timeMs: number = Date.now()): number | null {
  const code = typed.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const now = Math.floor(timeMs / STEP_MS);
  for (const step of [now, now - 1, now + 1]) {
    const expected = codeForStep(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step;
  }
  return null;
}

/** What the setup QR code encodes (Google's Key Uri Format). */
export function otpauthUrl({ issuer, account, secret }: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_MS / 1000) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
