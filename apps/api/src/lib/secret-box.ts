import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

/** AES-256-GCM for small secrets the server must be able to read back (a payment link's token, so staff can copy or
 * re-send the link after creating it). The lookup never uses this — it uses hashToken (lib/token-hash.ts) — so a database
 * leak alone exposes neither. The key is derived from PAYMENT_LINK_SECRET, else the admin JWT secret; rotating it only
 * stops staff re-copying existing links (they still work, and can be regenerated). */
function key(): Buffer {
  return createHash("sha256").update(`secret-box:v1:${process.env.PAYMENT_LINK_SECRET || env.jwtAccessSecret}`).digest();
}

/** Dashboard-managed integration credentials (modules/settings/integrations.service.ts): INTEGRATIONS_ENCRYPTION_KEY, else
 * the admin JWT secret every installation already has — so a new store needs no extra server step. A separate key from
 * payment links: rotating PAYMENT_LINK_SECRET must not wipe the store's gateway credentials. */
function integrationKey(): Buffer {
  return createHash("sha256").update(`secret-box:integrations:v1:${process.env.INTEGRATIONS_ENCRYPTION_KEY || env.jwtAccessSecret}`).digest();
}

function sealWith(secret: Buffer, plain: string, context?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  if (context) cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function openWith(secret: Buffer, sealed: string, context?: string): string | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || body === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64url"));
    if (context) decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function seal(plain: string): string {
  return sealWith(key(), plain);
}

/** null when the value can't be opened (wrong key after a rotation, or tampered). */
export function open(sealed: string): string | null {
  return openWith(key(), sealed);
}

/** Seals an integration value bound to its field name: a value copied into another field's row does not open. */
export function sealIntegrationValue(field: string, plain: string): string {
  return sealWith(integrationKey(), plain, `integration:${field}`);
}

/** null when it can't be opened — the key changed, the row was tampered with, or the database came from another store. */
export function openIntegrationValue(field: string, sealed: string): string | null {
  return openWith(integrationKey(), sealed, `integration:${field}`);
}

/** 2-step sign-in secrets (modules/auth/two-step.service.ts): TOTP_ENCRYPTION_KEY, else the admin JWT secret. Bound to the
 * admin, so a secret copied onto another admin's row does not open. */
function totpKey(): Buffer {
  return createHash("sha256").update(`secret-box:totp:v1:${process.env.TOTP_ENCRYPTION_KEY || env.jwtAccessSecret}`).digest();
}

export function sealTotpSecret(adminId: string, plain: string): string {
  return sealWith(totpKey(), plain, `admin-totp:${adminId}`);
}

/** null when it can't be opened (key changed, tampered, or another admin's). */
export function openTotpSecret(adminId: string, sealed: string): string | null {
  return openWith(totpKey(), sealed, `admin-totp:${adminId}`);
}
