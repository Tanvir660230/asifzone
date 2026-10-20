/**
 * Desired-state recording for the owner's-books facts that are not commerce (docs/FINANCE_OWNER_BOOKS.md): a day's ad
 * spend, a month's share of a prepaid cost. Same contract as the commerce projector: each fact has a semantic key, its
 * events are revisions `<key>#r<n>`; a changed fact supersedes the last revision, a vanished one gets a void revision,
 * an unchanged one records nothing. Facts dated before the Financial Opening Date are never posted.
 */
import { createHash } from "node:crypto";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import type { FinanceContext } from "./finance-context";
import { processFinancialEvent, recordFinancialEvent } from "./events.service";

export interface FinanceFact {
  semanticKey: string;
  type: string;
  /** The fact's accounting date (YYYY-MM-DD). */
  date: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

const stable = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const fingerprint = (f: FinanceFact) => createHash("sha256").update(stable({ type: f.type, date: f.date, payload: f.payload })).digest("hex").slice(0, 24);
const revisionOf = (key: string) => Number(/#r(\d+)$/.exec(key)?.[1] ?? 0);

/** Records the revisions that bring every fact under `prefix` to `desired`; returns the recorded event ids. */
export async function applyFinanceFacts(tx: AppTransactionClient, ctx: FinanceContext, prefix: string, desired: FinanceFact[]): Promise<string[]> {
  const opening = ctx.business.openingDate;
  const want = new Map(desired.filter((d) => opening && d.date >= opening).map((d) => [d.semanticKey, d]));
  const existing = await tx.financialEvent.findMany({
    where: { businessId: ctx.business.id, sourceInstallId: installId, eventKey: { startsWith: prefix } },
    select: { id: true, eventKey: true, eventType: true, payload: true, sourceEntityType: true, sourceEntityId: true, financialDate: true },
  });
  const bySemantic = new Map<string, typeof existing>();
  for (const e of existing) {
    const sk = e.eventKey.split("#")[0]!;
    bySemantic.set(sk, [...(bySemantic.get(sk) ?? []), e]);
  }
  const recorded: string[] = [];
  for (const sk of [...new Set([...want.keys(), ...bySemantic.keys()])].sort()) {
    const revs = (bySemantic.get(sk) ?? []).sort((a, b) => revisionOf(a.eventKey) - revisionOf(b.eventKey));
    const latest = revs[revs.length - 1];
    const latestPayload = (latest?.payload ?? {}) as { fp?: string; void?: boolean };
    const live = latest && !latestPayload.void ? latest : null;
    const d = want.get(sk);
    let rec: { f: FinanceFact; isVoid: boolean } | null = null;
    if (d) {
      if (!(live && latestPayload.fp === fingerprint(d))) rec = { f: d, isVoid: false };
    } else if (live) {
      rec = {
        f: { semanticKey: sk, type: live.eventType, date: live.financialDate.toISOString().slice(0, 10), entityType: live.sourceEntityType, entityId: live.sourceEntityId, payload: live.payload as Record<string, unknown> },
        isVoid: true,
      };
    }
    if (!rec) continue;
    const payload = { ...rec.f.payload, semanticKey: sk, fp: rec.isVoid ? "void" : fingerprint(rec.f), supersedes: live?.id ?? null, void: rec.isVoid };
    const { event } = await recordFinancialEvent(tx, {
      contract: "finance.event",
      contractVersion: 1,
      businessKey: ctx.business.key,
      brandKey: ctx.brand.key,
      source: { installId, system: "finance", entityType: rec.f.entityType, entityId: rec.f.entityId },
      event: { type: rec.f.type, version: 1, key: `${sk}#r${revs.length}`, occurredAt: new Date().toISOString() },
      financialDate: rec.f.date,
      currency: ctx.business.baseCurrency,
      payload,
    });
    recorded.push(event.id);
  }
  return recorded;
}

/** Posts recorded events one by one (each its own transaction; a failure stays FAILED for the outbox to retry). */
export async function postRecorded(ids: string[]): Promise<{ posted: number; failed: number }> {
  let posted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await processFinancialEvent(id);
      if (r === "posted") posted += 1;
      else if (r === "no_rule") failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { posted, failed };
}

/** Whether the books have started (an opening date with posted opening balances) — nothing posts before. */
export async function booksStarted(ctx: FinanceContext): Promise<boolean> {
  if (!ctx.business.openingDate) return false;
  const batch = await prisma.openingBalanceBatch.findUnique({ where: { businessId: ctx.business.id }, select: { status: true } });
  return batch?.status === "POSTED";
}
