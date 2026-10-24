/**
 * Stock hub entries (docs/STOCK_HUB.md): a Bought or Counted request, keyed by its Idempotency-Key. An entry composes
 * several existing documents, each written by its own service in its own transaction, so the entry remembers what each
 * step made (`steps`): a retry after a mid-way failure resumes, and a replay of a finished entry writes nothing.
 *
 * One request works on an entry at a time: claiming takes a lease (a conditional update) with a token of its own, and a
 * second request under the same key while the first is still working — a double tap — is told to wait instead of writing
 * twice. A lease left by a crashed process lapses after LEASE_MS. Every save, completion and release is conditional on
 * the token (fencing) and renews the lease: a request that outlived its lease finds it taken over and stops
 * (409 STOCK_ENTRY_LEASE_LOST) instead of writing over the retry that took over. What a step writes is deduplicated by
 * the step's own idempotency (treasury keys, the receipt / bill stamps — unique in the database — and stock sources).
 */
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type StockHubEntry, type StockHubEntryKind } from "@prisma/client";
import { prisma } from "../../config/prisma";
import type { FinanceActor } from "../finance/finance-audit";
import { dateColumn, financeError } from "../finance/finance-values";

const LEASE_MS = 120_000;
const leaseUntil = () => new Date(Date.now() + LEASE_MS);

/** A stable fingerprint of the request (key order doesn't matter). */
export function fingerprintOf(value: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v ?? null;
  return createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");
}

export type EntrySteps = Record<string, unknown>;
/** This request's hold on an entry. */
export interface Lease {
  id: string;
  token: string;
}
export interface Claimed {
  entry: StockHubEntry;
  /** It finished before: a replay — write nothing (no lease). */
  done: boolean;
  lease: Lease | null;
}

const entryKey = (kind: StockHubEntryKind, key: string) => `${kind.toLowerCase()}:${key}`;

/** The entry for this key, if any (a read — nothing is claimed). */
export function findEntry(businessId: string, kind: StockHubEntryKind, key: string) {
  return prisma.stockHubEntry.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: entryKey(kind, key) } } });
}

/** Takes the lease on an existing entry when it is free or lapsed. */
async function takeLease(existing: StockHubEntry): Promise<Claimed> {
  if (existing.completedAt) return { entry: existing, done: true, lease: null };
  const token = randomUUID();
  const claimed = await prisma.stockHubEntry.updateMany({
    where: { id: existing.id, completedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { leaseUntil: leaseUntil(), leaseToken: token },
  });
  if (!claimed.count) {
    const again = await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: existing.id } });
    if (again.completedAt) return { entry: again, done: true, lease: null };
    throw financeError(409, "STOCK_ENTRY_IN_PROGRESS", "This entry is still being saved — try again in a moment");
  }
  return { entry: await prisma.stockHubEntry.findUniqueOrThrow({ where: { id: existing.id } }), done: false, lease: { id: existing.id, token } };
}

/**
 * The entry for `key`, leased to this request. The same key with a different request → 409 IDEMPOTENCY_KEY_REUSED;
 * another request still working on it → 409 STOCK_ENTRY_IN_PROGRESS.
 */
export async function claimEntry(input: { businessId: string; kind: StockHubEntryKind; key: string; fingerprint: string; entryDate: string; steps: EntrySteps; actor: FinanceActor }): Promise<Claimed> {
  const idempotencyKey = entryKey(input.kind, input.key);
  const token = randomUUID();
  try {
    const entry = await prisma.stockHubEntry.create({
      data: {
        businessId: input.businessId, kind: input.kind, idempotencyKey, fingerprint: input.fingerprint, entryDate: dateColumn(input.entryDate),
        steps: input.steps as Prisma.InputJsonValue, leaseUntil: leaseUntil(), leaseToken: token, createdByAdminId: input.actor.type === "ADMIN" ? input.actor.adminId : null,
      },
    });
    return { entry, done: false, lease: { id: entry.id, token } };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const existing = await prisma.stockHubEntry.findUniqueOrThrow({ where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey } } });
  if (existing.fingerprint !== input.fingerprint) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different entry");
  return takeLease(existing);
}

/** An entry by id, leased to this request (finishing an incomplete entry). 404 unless it is this business's `kind`. */
export async function claimEntryById(businessId: string, kind: StockHubEntryKind, id: string): Promise<Claimed> {
  const existing = await prisma.stockHubEntry.findFirst({ where: { id, businessId, kind } });
  if (!existing) throw financeError(404, "STOCK_ENTRY_NOT_FOUND", "That entry doesn't exist");
  return takeLease(existing);
}

const leaseLost = () => financeError(409, "STOCK_ENTRY_LEASE_LOST", "This entry was taken over by a newer attempt — it finishes there; refresh to see it");

/** Still ours? Renews the lease before a step writes; a request that lost it stops here. */
export async function renewLease(lease: Lease): Promise<void> {
  const r = await prisma.stockHubEntry.updateMany({ where: { id: lease.id, leaseToken: lease.token, completedAt: null }, data: { leaseUntil: leaseUntil() } });
  if (!r.count) throw leaseLost();
}

/** Records what a step made and renews the lease — only while this request holds it. */
export async function saveSteps(lease: Lease, steps: EntrySteps): Promise<void> {
  const r = await prisma.stockHubEntry.updateMany({ where: { id: lease.id, leaseToken: lease.token, completedAt: null }, data: { steps: steps as Prisma.InputJsonValue, leaseUntil: leaseUntil() } });
  if (!r.count) throw leaseLost();
}

/** Every step done: the entry is final; replays return it. */
export async function completeEntry(lease: Lease, steps: EntrySteps): Promise<StockHubEntry> {
  const r = await prisma.stockHubEntry.updateMany({
    where: { id: lease.id, leaseToken: lease.token, completedAt: null },
    data: { steps: steps as Prisma.InputJsonValue, completedAt: new Date(), leaseUntil: null, leaseToken: null },
  });
  if (!r.count) throw leaseLost();
  return prisma.stockHubEntry.findUniqueOrThrow({ where: { id: lease.id } });
}

/** A step failed: the lease is released so a retry can resume at once — unless another request holds it by now. */
export async function releaseEntry(lease: Lease): Promise<void> {
  await prisma.stockHubEntry.updateMany({ where: { id: lease.id, leaseToken: lease.token }, data: { leaseUntil: null, leaseToken: null } }).catch(() => undefined);
}

/** A unique-index violation (Prisma's P2002, or a raw query's 23505). */
export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === "P2002" || (err.code === "P2010" && /23505/.test(err.message));
  return false;
}

/** How the hub names a variant: "Product — size / colour" (a material's default spec "Standard" left out). */
export function variantLabel(v: { size: string | null; color: string | null; product: { name: string } }): string {
  const parts = [v.size, v.color].map((s) => s?.trim() ?? "").filter((s) => s && s !== "Standard");
  return parts.length ? `${v.product.name} — ${parts.join(" / ")}` : v.product.name;
}

/** The unit stock is counted in: a material's stock unit (ml, pcs…); finished goods in pieces. */
export const unitOf = (p: { kind: string; stockUnit: string | null }) => (p.kind === "MATERIAL" ? p.stockUnit?.trim() || "pcs" : "pcs");

/** Volumes and weights (ml, l, g, kg) are what a recipe fills from — raw material; anything counted in pieces, rolls or
 * metres is packaging (bottles, boxes, stickers, poly). Read from the stock unit, so it needs no setting per material. */
const RAW_UNITS = new Set(["ml", "l", "litre", "liter", "g", "gm", "gram", "kg"]);
export const materialRole = (unit: string): "RAW" | "PACKAGING" => (RAW_UNITS.has(unit.trim().toLowerCase()) ? "RAW" : "PACKAGING");
