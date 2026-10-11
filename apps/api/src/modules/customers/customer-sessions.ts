/**
 * Customer refresh sessions (Phase 11, BD-11.3; docs/PHASE_11_IMPLEMENTATION_CONTRACT.md §5.2).
 *
 *   issued → active → rotated → … (same family) ;  revoked (logout / logout-all / password change|reset / reuse) ;  expired
 *
 * - A login opens a **family** (`familyId`) with a fixed `expiresAt` = login + 7 days. Every refresh rotates to a new opaque
 *   token in the same family with the **same** `expiresAt` — the maximum session length never grows.
 * - Only SHA-256 hashes of refresh tokens are stored.
 * - **Reuse detection.** A token that was already rotated or revoked is a replay:
 *   - presented within REUSE_GRACE_MS of its rotation (two browser tabs refreshing at once): the caller gets a fresh access
 *     token but **no** new refresh token — the family is neither revoked nor forked, and the cookie the winning tab set is the
 *     one that keeps working;
 *   - presented later: the whole family is revoked (`reuse_detected`) — a stolen token and its legitimate holder can't both
 *     keep a session alive.
 * - `Customer.tokenVersion` is snapshotted on each token; a password reset or logout-everywhere bumps it, which also kills
 *   legacy (pre-Phase-11) stateless refresh tokens.
 * - Legacy stateless refresh JWTs are accepted **once**: converted into a DB family (never longer than the JWT's own expiry)
 *   and recorded as rotated, so presenting the same JWT again is detected as reuse.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { hashToken } from "../../lib/token-hash";
import { signCustomerAccessToken, verifyCustomerRefreshToken } from "../../lib/customer-jwt";

export const CUSTOMER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REUSE_GRACE_MS = 10_000;

export type SessionRevocationReason = "logout" | "logout_all" | "password_change" | "password_reset" | "reuse_detected";

export interface IssuedSession {
  accessToken: string;
  /** null within the reuse grace window: keep the refresh cookie the browser already has. */
  refreshToken: string | null;
  persistent: boolean;
}

type Tx = Prisma.TransactionClient;
const expired = () => AppError.unauthorized("Session expired, please log in again");

function newOpaqueToken(): string {
  return crypto.randomBytes(40).toString("hex");
}

async function createToken(
  tx: Tx,
  input: { customerId: string; familyId: string; tokenVersion: number; persistent: boolean; expiresAt: Date; userAgent?: string | null },
) {
  const raw = newOpaqueToken();
  const row = await tx.customerRefreshToken.create({
    data: { ...input, userAgent: input.userAgent ?? null, tokenHash: hashToken(raw) },
    select: { id: true },
  });
  return { raw, id: row.id };
}

/** Opens a new session family for a just-authenticated customer. */
export async function issueCustomerSession(
  customerId: string,
  opts: { persistent?: boolean; userAgent?: string | null; db?: Tx } = {},
): Promise<IssuedSession> {
  const run = async (tx: Tx) => {
    const { tokenVersion } = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { tokenVersion: true } });
    const persistent = opts.persistent ?? true;
    const { raw } = await createToken(tx, {
      customerId,
      familyId: crypto.randomUUID(),
      tokenVersion,
      persistent,
      expiresAt: new Date(Date.now() + CUSTOMER_SESSION_TTL_MS),
      userAgent: opts.userAgent,
    });
    return { accessToken: signCustomerAccessToken({ customerId }), refreshToken: raw, persistent };
  };
  return opts.db ? run(opts.db) : prisma.$transaction(run);
}

type RotationOutcome =
  | { kind: "rotated"; session: IssuedSession }
  | { kind: "grace"; customerId: string; persistent: boolean }
  | { kind: "reuse" }
  | { kind: "invalid" };

/** Refresh: rotate the presented token. Throws 401 for anything but a live token (or a grace-window replay). */
export async function rotateCustomerSession(rawToken: string, userAgent?: string | null): Promise<IssuedSession> {
  const now = new Date();
  const outcome: RotationOutcome = await prisma.$transaction(async (tx) => {
    const row = await tx.customerRefreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!row) return convertLegacyToken(tx, rawToken, userAgent);
    if (row.revokedAt || row.expiresAt <= now) return { kind: "invalid" } as const;

    if (row.rotatedAt) {
      if (now.getTime() - row.rotatedAt.getTime() <= REUSE_GRACE_MS) return { kind: "grace", customerId: row.customerId, persistent: row.persistent } as const;
      await revokeFamily(tx, row.familyId, "reuse_detected", now);
      return { kind: "reuse" } as const;
    }

    const customer = await tx.customer.findUnique({ where: { id: row.customerId }, select: { tokenVersion: true } });
    if (!customer || customer.tokenVersion !== row.tokenVersion) return { kind: "invalid" } as const;

    // The claim: only one concurrent refresh of this token can rotate it.
    const claimed = await tx.customerRefreshToken.updateMany({ where: { id: row.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: now } });
    if (claimed.count !== 1) return { kind: "grace", customerId: row.customerId, persistent: row.persistent } as const;

    const next = await createToken(tx, { customerId: row.customerId, familyId: row.familyId, tokenVersion: row.tokenVersion, persistent: row.persistent, expiresAt: row.expiresAt, userAgent });
    await tx.customerRefreshToken.update({ where: { id: row.id }, data: { replacedById: next.id } });
    return { kind: "rotated", session: { accessToken: signCustomerAccessToken({ customerId: row.customerId }), refreshToken: next.raw, persistent: row.persistent } } as const;
  });

  switch (outcome.kind) {
    case "rotated":
      return outcome.session;
    case "grace":
      return { accessToken: signCustomerAccessToken({ customerId: outcome.customerId }), refreshToken: null, persistent: outcome.persistent };
    default:
      throw expired(); // "reuse" committed the family revocation before this throws
  }
}

/** A pre-Phase-11 stateless refresh JWT: accepted once, converted into a DB family recorded as already rotated. */
async function convertLegacyToken(tx: Tx, rawToken: string, userAgent?: string | null): Promise<RotationOutcome> {
  if (rawToken.split(".").length !== 3) return { kind: "invalid" };
  let payload: { customerId: string; tokenVersion: number; exp?: number };
  try {
    payload = verifyCustomerRefreshToken(rawToken) as typeof payload;
  } catch {
    return { kind: "invalid" };
  }
  const customer = await tx.customer.findUnique({ where: { id: payload.customerId }, select: { tokenVersion: true } });
  if (!customer || customer.tokenVersion !== payload.tokenVersion) return { kind: "invalid" };

  const now = new Date();
  const legacyExpiry = payload.exp ? new Date(payload.exp * 1000) : new Date(now.getTime() + CUSTOMER_SESSION_TTL_MS);
  const expiresAt = new Date(Math.min(legacyExpiry.getTime(), now.getTime() + CUSTOMER_SESSION_TTL_MS));
  const familyId = crypto.randomUUID();
  try {
    // The legacy JWT itself becomes a rotated row: presenting it again is reuse.
    const legacy = await tx.customerRefreshToken.create({
      data: { customerId: payload.customerId, familyId, tokenHash: hashToken(rawToken), tokenVersion: payload.tokenVersion, persistent: true, expiresAt, rotatedAt: now, userAgent: userAgent ?? null },
    });
    const next = await createToken(tx, { customerId: payload.customerId, familyId, tokenVersion: payload.tokenVersion, persistent: true, expiresAt, userAgent });
    await tx.customerRefreshToken.update({ where: { id: legacy.id }, data: { replacedById: next.id } });
    return { kind: "rotated", session: { accessToken: signCustomerAccessToken({ customerId: payload.customerId }), refreshToken: next.raw, persistent: true } };
  } catch (err) {
    // Two tabs converting the same legacy token at once: the loser behaves like a grace-window replay.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { kind: "grace", customerId: payload.customerId, persistent: true };
    throw err;
  }
}

async function revokeFamily(tx: Tx, familyId: string, reason: SessionRevocationReason, now = new Date()) {
  await tx.customerRefreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
}

/** Logout: revoke the presented token's family. Silent for unknown tokens (no existence signal). */
export async function revokeCustomerSession(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const row = await prisma.customerRefreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, select: { familyId: true } });
  if (row) {
    await prisma.$transaction((tx) => revokeFamily(tx, row.familyId, "logout"));
    return;
  }
  // A legacy stateless token can't be revoked individually: bump tokenVersion (ends every legacy token of this customer).
  if (rawToken.split(".").length === 3) {
    try {
      const { customerId } = verifyCustomerRefreshToken(rawToken);
      await prisma.customer.updateMany({ where: { id: customerId }, data: { tokenVersion: { increment: 1 } } });
    } catch {
      // invalid / expired — nothing to revoke
    }
  }
}

/** Logout everywhere / password change / password reset: every family of the customer, plus legacy tokens via tokenVersion. */
export async function revokeAllCustomerSessions(customerId: string, reason: SessionRevocationReason, db?: Tx): Promise<void> {
  const run = async (tx: Tx) => {
    const now = new Date();
    await tx.customerRefreshToken.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
    await tx.customer.update({ where: { id: customerId }, data: { tokenVersion: { increment: 1 } } });
  };
  return db ? run(db) : prisma.$transaction(run);
}

/** Housekeeping (daily): drop tokens whose family expired more than a day ago. Nothing else reads expired rows. */
export async function cleanupExpiredCustomerSessions(now = new Date()): Promise<number> {
  const result = await prisma.customerRefreshToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
  return result.count;
}
