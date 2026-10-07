/**
 * Accounting event infrastructure (Financial Core Phase 1, docs/FINANCE_PHASE_1.md §5).
 *
 *   producer transaction ──recordFinancialEvent(tx, envelope)──► FinancialEvent (inbox, unique (installId, eventKey))
 *                                                             └► OutboxEvent "finance-event-post" (same transaction)
 *   outbox dispatcher/worker (existing, retried, FAILED surfaced) ──► processFinancialEvent(id)
 *        lock event → posting rule (eventType@version) → journal.service postJournalInTx (idempotency key = event identity)
 *        → event POSTED, in ONE transaction.
 *
 * Exactly-once posting from at-least-once delivery: the inbox row is unique per event identity (a repeat delivery finds
 * it), processing holds the row lock, a POSTED event is final (database trigger), and the journal's idempotency key is
 * derived from the event identity (a second journal for the same event is impossible: unique (businessId, key) and
 * unique financialEventId).
 *
 * No posting rules for commerce exist yet (Phase 3 registers them). An event without a rule is kept as FAILED with
 * NO_POSTING_RULE and can be retried once a rule ships — it is never dropped.
 */
import type { FinancialEvent, Prisma } from "@prisma/client";
import type { ZodType } from "zod";
import {
  eventJournalKey,
  financialEventEnvelopeSchema,
  financialEventHandlerKey,
  monthPeriod,
  addDays,
  type AccountMappingKey,
  type FinancialEventEnvelope,
} from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordOutboxEvents } from "../outbox/outbox";
import { captureError } from "../../lib/observability/error-capture";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { resolveMappedAccount } from "./chart.service";
import { postJournalInTx, type JournalLineSpec } from "./journal.service";
import { businessDateOf, dateColumn, financeError, mapFinanceDbError } from "./finance-values";
import { financeTransaction } from "./finance-tx";

// ── posting rules ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface PostingRuleLine {
  /** A mapping key (preferred — never an account id in code) or, for rules that carry it in the payload, an account id. */
  account: AccountMappingKey | { accountId: string };
  /** Minor units. */
  debit: number;
  credit: number;
  memo?: string | null;
  partyType?: string | null;
  partyId?: string | null;
  valuationStatus?: JournalLineSpec["valuationStatus"];
}

export type PostingRuleResult = { ignore: string } | { description: string; reference?: string | null; lines: PostingRuleLine[] };

export interface PostingRule<P = Record<string, unknown>> {
  payload: ZodType<P>;
  build(payload: P, ctx: { event: FinancialEvent; business: FinanceBusinessInfo }): PostingRuleResult;
}

const RULES = new Map<string, PostingRule<never>>();

/** Registers the posting rule for one event type at one version. A version is never re-registered with other behaviour. */
export function registerPostingRule<P>(type: string, version: number, rule: PostingRule<P>): void {
  const key = financialEventHandlerKey(type, version);
  if (RULES.has(key)) throw new Error(`[finance] posting rule ${key} is already registered`);
  RULES.set(key, rule as unknown as PostingRule<never>);
}

export function postingRuleKeys(): string[] {
  return [...RULES.keys()].sort();
}

/** Test support only: forget a rule registered by a test. */
export function unregisterPostingRuleForTests(type: string, version: number): void {
  if (process.env.NODE_ENV !== "test") throw new Error("unregisterPostingRuleForTests is test-only");
  RULES.delete(financialEventHandlerKey(type, version));
}

// ── recording ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const FINANCE_EVENT_OUTBOX_TYPE = "finance.event_recorded.v1";

export interface RecordedEvent {
  event: FinancialEvent;
  /** True when this envelope's identity was already recorded (a repeat delivery). */
  duplicate: boolean;
  /** For a duplicate: whether its content matches what was recorded first. */
  payloadMatches: boolean;
}

function samePayload(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p.localeCompare(q))) : x));
  return canon(a) === canon(b);
}

/**
 * Records a financial event inside the PRODUCER's transaction (so the fact and the event commit together) and schedules
 * its posting through the outbox. Safe to call any number of times for the same event identity.
 */
export async function recordFinancialEvent(tx: AppTransactionClient, input: FinancialEventEnvelope): Promise<RecordedEvent> {
  const parsed = financialEventEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw financeError(400, "EVENT_INVALID", `Invalid financial event: ${parsed.error.issues[0]?.message ?? "bad envelope"}`, { issues: parsed.error.issues });
  const env = parsed.data;
  const business = await tx.financeBusiness.findUnique({ where: { key: env.businessKey } });
  if (!business) throw financeError(400, "EVENT_UNKNOWN_BUSINESS", `Unknown business ${env.businessKey}`);
  const brand = await tx.financeBrand.findUnique({ where: { businessId_key: { businessId: business.id, key: env.brandKey } } });
  if (!brand || !brand.isActive) throw financeError(400, "EVENT_UNKNOWN_BRAND", `Unknown or inactive brand ${env.brandKey}`);
  if (brand.installId && brand.installId !== env.source.installId) {
    throw financeError(400, "EVENT_SOURCE_MISMATCH", `Brand ${env.brandKey} reports from installation ${brand.installId}, not ${env.source.installId}`);
  }
  if (env.currency !== business.baseCurrency) throw financeError(400, "EVENT_CURRENCY", `The books are kept in ${business.baseCurrency}; got ${env.currency}`);

  const identity = { sourceInstallId_eventKey: { sourceInstallId: env.source.installId, eventKey: env.event.key } };
  const created = await tx.financialEvent.createMany({
    data: [{
      businessId: business.id,
      brandId: brand.id,
      sourceInstallId: env.source.installId,
      sourceSystem: env.source.system,
      sourceEntityType: env.source.entityType,
      sourceEntityId: env.source.entityId,
      eventType: env.event.type,
      eventVersion: env.event.version,
      eventKey: env.event.key,
      occurredAt: new Date(env.event.occurredAt),
      financialDate: dateColumn(env.financialDate),
      currency: env.currency,
      payload: env.payload as Prisma.InputJsonValue,
    }],
    skipDuplicates: true,
  });
  const event = await tx.financialEvent.findUniqueOrThrow({ where: identity });
  if (created.count === 0) {
    const payloadMatches = samePayload(event.payload, env.payload) && event.eventType === env.event.type && event.eventVersion === env.event.version;
    if (!payloadMatches) {
      // A producer reused an event key for different content: never post it twice and never roll back the producer's
      // business change for it — surface it loudly instead.
      captureError(new Error(`[finance] event ${env.source.installId}:${env.event.key} redelivered with different content`), { msg: "[finance] conflicting event redelivery", detail: event.id });
    }
    return { event, duplicate: true, payloadMatches };
  }
  await recordOutboxEvents(tx, [{
    eventType: FINANCE_EVENT_OUTBOX_TYPE,
    consumer: "finance-event-post",
    eventKey: `finance-event:${event.id}`,
    aggregateType: "FinancialEvent",
    aggregateId: event.id,
    payload: { financialEventId: event.id },
  }]);
  return { event, duplicate: false, payloadMatches: true };
}

// ── processing ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ProcessOutcome = "posted" | "already_posted" | "ignored" | "no_rule";

const SYSTEM_EVENT_ACTOR = (e: FinancialEvent): FinanceActor => ({ type: "SYSTEM", label: `event:${e.sourceInstallId}` });

/** The accounting date for an event: its financial date, or — when that period is CLOSED — the first day of the next
 * period that isn't, so a late event never reopens closed books (docs/FINANCE_PHASE_1.md §4.3). */
async function postingDateFor(tx: AppTransactionClient, business: FinanceBusinessInfo, financialDate: string): Promise<string> {
  let date = financialDate;
  if (business.openingDate && date < business.openingDate) date = business.openingDate;
  for (let i = 0; i < 36; i++) {
    const p = await tx.financialPeriod.findUnique({ where: { businessId_startDate: { businessId: business.id, startDate: dateColumn(monthPeriod(date).startDate) } } });
    if (!p || p.status !== "CLOSED") return date;
    date = addDays(monthPeriod(date).endDate, 1);
  }
  throw financeError(409, "NO_OPEN_PERIOD", "No open period found for this event");
}

export async function processFinancialEvent(eventId: string): Promise<ProcessOutcome> {
  try {
    return await financeTransaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "FinancialEvent" WHERE id = ${eventId} FOR UPDATE`;
      if (!locked.length) throw financeError(404, "EVENT_NOT_FOUND", "Financial event not found");
      const event = await tx.financialEvent.findUniqueOrThrow({ where: { id: eventId } });
      if (event.status === "POSTED") return "already_posted" as const;
      if (event.status === "IGNORED") return "ignored" as const;
      const bizRow = await tx.financeBusiness.findUniqueOrThrow({ where: { id: event.businessId } });
      const business: FinanceBusinessInfo = { ...bizRow, openingDate: bizRow.openingDate ? businessDateOf(bizRow.openingDate) : null };
      const actor = SYSTEM_EVENT_ACTOR(event);

      const rule = RULES.get(financialEventHandlerKey(event.eventType, event.eventVersion));
      if (!rule) {
        await tx.financialEvent.update({ where: { id: event.id }, data: { status: "FAILED", attempts: { increment: 1 }, lastError: `NO_POSTING_RULE: no posting rule for ${event.eventType}@${event.eventVersion}` } });
        return "no_rule" as const;
      }
      const payload = rule.payload.safeParse(event.payload);
      if (!payload.success) throw financeError(400, "EVENT_PAYLOAD_INVALID", `Payload of ${event.eventType}@${event.eventVersion} is invalid: ${payload.error.issues[0]?.message}`);
      const result = rule.build(payload.data as never, { event, business });
      if ("ignore" in result) {
        await tx.financialEvent.update({ where: { id: event.id }, data: { status: "IGNORED", processedAt: new Date(), lastError: null } });
        await recordFinanceAudit(tx, { businessId: business.id, actor, action: "event.ignore", entityType: "FinancialEvent", entityId: event.id, reason: result.ignore });
        return "ignored" as const;
      }
      const lines: JournalLineSpec[] = [];
      for (const l of result.lines) {
        const accountId = typeof l.account === "string" ? (await resolveMappedAccount(tx, business.id, l.account)).id : l.account.accountId;
        lines.push({ accountId, debit: l.debit, credit: l.credit, memo: l.memo, partyType: l.partyType, partyId: l.partyId, valuationStatus: l.valuationStatus, brandId: event.brandId });
      }
      const financialDate = businessDateOf(event.financialDate);
      const entryDate = await postingDateFor(tx, business, financialDate);
      const { entry } = await postJournalInTx(tx, business, {
        entryDate,
        description: result.description,
        reference: result.reference ?? (entryDate !== financialDate ? `late event dated ${financialDate}` : null),
        brandId: event.brandId,
        kind: "EVENT",
        lines,
        sourceType: event.sourceEntityType,
        sourceId: event.sourceEntityId,
        financialEventId: event.id,
        idempotencyKey: eventJournalKey(event.sourceInstallId, event.eventKey),
      }, actor);
      await tx.financialEvent.update({ where: { id: event.id }, data: { status: "POSTED", processedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "event.post", entityType: "FinancialEvent", entityId: event.id, sourceRef: entry.id });
      return "posted" as const;
    }, { timeout: 20_000 });
  } catch (err) {
    const mapped = mapFinanceDbError(err);
    const message = mapped instanceof Error ? mapped.message : String(mapped);
    await prisma.financialEvent
      .updateMany({ where: { id: eventId, status: { in: ["RECEIVED", "FAILED"] } }, data: { status: "FAILED", attempts: { increment: 1 }, lastError: message.slice(0, 1000) } })
      .catch(() => undefined);
    throw mapped;
  }
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function listFinancialEvents(q: { status?: FinancialEvent["status"]; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where = { businessId: business.id, status: q.status };
  const [total, events] = await Promise.all([
    prisma.financialEvent.count({ where }),
    prisma.financialEvent.findMany({ where, orderBy: { receivedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { journalEntry: { select: { id: true, number: true } } } }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, events: events.map((e) => ({ ...e, financialDate: businessDateOf(e.financialDate) })) };
}

/** Manually re-runs a RECEIVED / FAILED event (e.g. after a posting rule shipped). */
export async function retryFinancialEvent(eventId: string) {
  const { business } = await getFinanceContext();
  const event = await prisma.financialEvent.findFirst({ where: { id: eventId, businessId: business.id } });
  if (!event) throw financeError(404, "EVENT_NOT_FOUND", "Financial event not found");
  try {
    return { outcome: await processFinancialEvent(eventId) };
  } catch (err) {
    throw mapFinanceDbError(err);
  }
}
