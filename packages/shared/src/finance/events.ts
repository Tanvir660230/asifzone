/**
 * The financial event contract (Financial Core Phase 1, docs/FINANCE_PHASE_1.md §5).
 *
 * Every financial fact that enters the ledger from outside the finance module arrives as one ENVELOPE. Today the only
 * producer is this installation's own code (it records the envelope in its own transaction). The contract is shaped so a
 * different installation — another brand with its own database — can later send the SAME envelope over an authenticated
 * channel without the accounting core changing: the envelope names the business, the brand, the source installation,
 * the source entity, the event and its version, the financial date and the currency.
 *
 * Identity: (source.installId, event.key) is the event's accounting identity. It is unique in the ledger's inbox, so a
 * retried webhook, queue message, API call or a restarted worker can deliver an envelope any number of times and it is
 * recorded — and posted — once.
 */
import { z } from "zod";
import { isBusinessDate } from "./periods";

export const FINANCIAL_EVENT_CONTRACT = "finance.event" as const;
export const FINANCIAL_EVENT_CONTRACT_VERSION = 1 as const;

const slug = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_.-]*$/, "lowercase letters, digits, . _ - only");

export const financialEventEnvelopeSchema = z.object({
  contract: z.literal(FINANCIAL_EVENT_CONTRACT),
  contractVersion: z.literal(FINANCIAL_EVENT_CONTRACT_VERSION),
  /** The business whose books this event belongs to (FinanceBusiness.key). */
  businessKey: slug,
  /** The brand within that business (FinanceBrand.key). */
  brandKey: slug,
  source: z.object({
    /** The installation that produced the fact (INSTALL_ID). Part of the idempotency identity. */
    installId: slug,
    /** Producing subsystem, e.g. "commerce". */
    system: slug,
    /** The source record, e.g. entityType "Order", entityId "<cuid>". */
    entityType: z.string().trim().min(1).max(64),
    entityId: z.string().trim().min(1).max(128),
  }),
  event: z.object({
    /** Dotted business event name, e.g. "order.realised". Versioned separately so payload shapes can evolve. */
    type: z.string().trim().min(1).max(96).regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "dotted lowercase name"),
    version: z.number().int().min(1).max(999),
    /** Producer-chosen idempotency key, unique per installation, e.g. "order:<id>:realised". */
    key: z.string().trim().min(1).max(200),
    /** When the fact happened (ISO-8601 instant). */
    occurredAt: z.string().datetime({ offset: true }),
  }),
  /** The accounting date (business date in the business timezone) the journal is dated. */
  financialDate: z.string().refine(isBusinessDate, "financialDate must be a valid YYYY-MM-DD business date"),
  /** ISO 4217 currency of every amount in the payload. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Event-type-specific facts; validated by the posting rule registered for (event.type, event.version). */
  payload: z.record(z.string(), z.unknown()),
});

export type FinancialEventEnvelope = z.infer<typeof financialEventEnvelopeSchema>;

/** The handler-registry key for an event type at a version, e.g. "order.realised@1". */
export function financialEventHandlerKey(type: string, version: number): string {
  return `${type}@${version}`;
}

/** The idempotency key of the journal an event posts — derived from the event's identity, so a repeat finds it. */
export function eventJournalKey(installId: string, eventKey: string): string {
  return `event:${installId}:${eventKey}`;
}
