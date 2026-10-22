/**
 * Stock hub entries (docs/STOCK_HUB.md): a Bought or Counted request, keyed by its Idempotency-Key. An entry composes
 * several existing documents, each written by its own service in its own transaction, so the entry remembers what each
 * step made (`steps`): a retry after a mid-way failure resumes, and a replay of a finished entry writes nothing.
 *
 * One request works on an entry at a time: claiming takes a lease (a conditional update), and a second request under the
 * same key while the first is still working — a double tap — is told to wait instead of writing twice. A lease left by a
 * crashed process lapses after LEASE_MS.
 */
import { createHash } from "node:crypto";
import { Prisma, type StockHubEntry, type StockHubEntryKind } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { FinanceActor } from "../finance/finance-audit";
import { dateColumn, financeError } from "../finance/finance-values";

const LEASE_MS = 120_000;

/** A stable fingerprint of the request (key order doesn't matter). */
export function fingerprintOf(value: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v ?? null;
  return createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");
}

export type EntrySteps = Record<string, unknown>;

/**
 * The entry for `key`, leased to this request. `done`: it finished before (a replay — write nothing). The same key with a
 * different request → 409 IDEMPOTENCY_KEY_REUSED; another request still working on it → 409 STOCK_ENTRY_IN_PROGRESS.
 */
export async function claimEntry(input: { businessId: string; kind: StockHubEntryKind; key: string; fingerprint: string; entryDate: string; steps: EntrySteps; actor: FinanceActor }): Promise<{ entry: StockHubEntry; done: boolean }> {
  const idempotencyKey = `${input.kind.toLowerCase()}:${input.key}`;
  const leaseUntil = () => new Date(Date.now() + LEASE_MS);
  try {
    const entry = await prisma.stockHubEntry.create({
      data: {
        businessId: input.businessId, kind: input.kind, idempotencyKey, fingerprint: input.fingerprint, entryDate: dateColumn(input.entryDate),
        steps: input.steps as Prisma.InputJsonValue, leaseUntil: leaseUntil(), createdByAdminId: input.actor.type === "ADMIN" ? input.actor.adminId : null,
      },
    });
    return { entry, done: false };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const existing = await prisma.stockHubEntry.findUniqueOrThrow({ where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey } } });
  if (existing.fingerprint !== input.fingerprint) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different entry");
  if (existing.completedAt) return { entry: existing, done: true };
  const now = new Date();
  const claimed = await prisma.stockHubEntry.updateMany({
    where: { id: existing.id, completedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: leaseUntil() },
  });
  if (!claimed.count) {
    const again = await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: existing.id } });
    if (again.completedAt) return { entry: again, done: true };
    throw financeError(409, "STOCK_ENTRY_IN_PROGRESS", "This entry is still being saved — try again in a moment");
  }
  return { entry: await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: existing.id } }), done: false };
}

/** Records what a step made (the lease is kept). */
export async function saveSteps(id: string, steps: EntrySteps): Promise<void> {
  await prisma.stockHubEntry.update({ where: { id }, data: { steps: steps as Prisma.InputJsonValue } });
}

/** Every step done: the entry is final; replays return it. */
export async function completeEntry(id: string, steps: EntrySteps): Promise<StockHubEntry> {
  return prisma.stockHubEntry.update({ where: { id }, data: { steps: steps as Prisma.InputJsonValue, completedAt: new Date(), leaseUntil: null } });
}

/** A step failed: the lease is released so a retry can resume at once. */
export async function releaseEntry(id: string): Promise<void> {
  await prisma.stockHubEntry.update({ where: { id }, data: { leaseUntil: null } }).catch(() => undefined);
}

/** How the hub names a variant: "Product — size / colour" (a material's default spec "Standard" left out). */
export function variantLabel(v: { size: string | null; color: string | null; product: { name: string } }): string {
  const parts = [v.size, v.color].map((s) => s?.trim() ?? "").filter((s) => s && s !== "Standard");
  return parts.length ? `${v.product.name} — ${parts.join(" / ")}` : v.product.name;
}

/** The unit stock is counted in: a material's stock unit (ml, pcs…); finished goods in pieces. */
export const unitOf = (p: { kind: string; stockUnit: string | null }) => (p.kind === "MATERIAL" ? p.stockUnit?.trim() || "pcs" : "pcs");
