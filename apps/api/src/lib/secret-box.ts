import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

/** AES-256-GCM for small secrets the server must be able to read back (a payment link's token, so staff can copy or
 * re-send the link after creating it). The lookup never uses this — it uses hashToken (lib/token-hash.ts) — so a database
 * leak alone exposes neither. The key is derived from PAYMENT_LINK_SECRET, else the admin JWT secret; rotating it only
 * stops staff re-copying existing links (they still work, and can be regenerated). */
function key(): Buffer {
  return createHash("sha256").update(`secret-box:v1:${process.env.PAYMENT_LINK_SECRET || env.jwtAccessSecret}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** null when the value can't be opened (wrong key after a rotation, or tampered). */
export function open(sealed: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
