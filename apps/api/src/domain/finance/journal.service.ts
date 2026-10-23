/**
 * The central journal posting service (Financial Core Phase 1, docs/FINANCE_PHASE_1.md §4) — the ONLY code that writes
 * JournalEntry / JournalLine (architecture guard: finance-writers.guard.test.ts). Every other module that has a financial
 * consequence records a financial event (events.service.ts) or calls a finance command that ends here.
 *
 * Rules (each also enforced by the database, see the migration header):
 *  - a journal is created DRAFT and posted by a status change; posted = immutable, corrected only by reversal (+ correction);
 *  - Σ debit = Σ credit > 0 over ≥ 2 lines, each line one positive side, on active postable accounts of the business;
 *  - nothing posts before the Financial Opening Date (opening balances post ON it), into a CLOSED period, or into a
 *    SOFT_CLOSED period without finance.period_close;
 *  - an idempotency key (request, event, reversal, correction) makes a repeat return the entry it already made, and a
 *    different request reusing the key a 409;
 *  - every write carries its FinanceAuditEntry in the same transaction.
 */
import type { JournalEntryKind, Prisma } from "@prisma/client";
import { checkJournal, journalFingerprint, reverseLines, compareBusinessDates } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { financeTransaction } from "./finance-tx";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { ensurePeriod } from "./periods.service";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor, FULL_VIEW, type FinanceViewer } from "./finance-values";

export interface JournalLineSpec {
  accountId: string;
  /** Minor units. */
  debit: number;
  credit: number;
  brandId?: string | null;
  memo?: string | null;
  partyType?: string | null;
  partyId?: string | null;
  valuationStatus?: "KNOWN" | "ESTIMATED" | "MISSING" | "OPENING_BALANCE" | null;
}

export interface JournalSpec {
  entryDate: string;
  description: string;
  reference?: string | null;
  brandId?: string | null;
  kind: JournalEntryKind;
  lines: JournalLineSpec[];
  sourceType?: string | null;
  sourceId?: string | null;
  financialEventId?: string | null;
  idempotencyKey?: string | null;
  reversesEntryId?: string | null;
  correctsEntryId?: string | null;
  reason?: string | null;
}

/** Major-unit line input from the admin API (already schema-validated). */
export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  brandId?: string | null;
  memo?: string | null;
  partyType?: string | null;
  partyId?: string | null;
  valuationStatus?: JournalLineSpec["valuationStatus"];
}

const ENTRY_INCLUDE = { lines: { orderBy: { lineNo: "asc" } }, reversedBy: { select: { id: true, number: true } }, correctedBy: { select: { id: true, number: true } } } satisfies Prisma.JournalEntryInclude;
type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

export function journalDto(e: EntryRow) {
  const cur = e.currency;
  return {
    id: e.id,
    number: e.number,
    status: e.status,
    kind: e.kind,
    entryDate: businessDateOf(e.entryDate),
    periodId: e.periodId,
    description: e.description,
    reference: e.reference,
    brandId: e.brandId,
    currency: cur,
    totalDebit: toMajorNumber(toMinor(e.totalDebit, cur), cur),
    totalCredit: toMajorNumber(toMinor(e.totalCredit, cur), cur),
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    financialEventId: e.financialEventId,
    reversesEntryId: e.reversesEntryId,
    correctsEntryId: e.correctsEntryId,
    reversedBy: e.reversedBy,
    correctedBy: e.correctedBy,
    reason: e.reason,
    createdByAdminId: e.createdByAdminId,
    postedByAdminId: e.postedByAdminId,
    postedAt: e.postedAt,
    createdAt: e.createdAt,
    lines: e.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      accountId: l.accountId,
      debit: toMajorNumber(toMinor(l.debit, cur), cur),
      credit: toMajorNumber(toMinor(l.credit, cur), cur),
      brandId: l.brandId,
      memo: l.memo,
      partyType: l.partyType,
      partyId: l.partyId,
      valuationStatus: l.valuationStatus,
    })),
  };
}
export type JournalDto = ReturnType<typeof journalDto>;

export function linesFromInput(lines: JournalLineInput[], currency: string): JournalLineSpec[] {
  return lines.map((l) => ({ ...l, debit: toMinor(l.debit, currency), credit: toMinor(l.credit, currency) }));
}

function fingerprintOf(spec: JournalSpec, currency: string): string {
  return `${spec.kind}#${journalFingerprint({ entryDate: spec.entryDate, currency, lines: spec.lines })}`;
}

/** Validates a spec against the amounts engine, the accounts / brands of the business and the date rules. */
async function validateSpec(tx: AppTransactionClient, business: FinanceBusinessInfo, spec: JournalSpec, actor: FinanceActor, forPosting: boolean) {
  const check = checkJournal(spec.lines);
  if (!check.ok) throw financeError(400, "JOURNAL_INVALID", check.issues[0]?.message ?? "Invalid journal", { issues: check.issues });

  const accountIds = [...new Set(spec.lines.map((l) => l.accountId))];
  const accounts = await tx.ledgerAccount.findMany({ where: { id: { in: accountIds }, businessId: business.id } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    const a = byId.get(id);
    if (!a) throw financeError(400, "ACCOUNT_NOT_FOUND", `Account ${id} doesn't exist in this business`);
    if (!a.isPostable) throw financeError(400, "ACCOUNT_NOT_POSTABLE", `${a.code} ${a.name} is a group account; post to one of its children`);
    if (!a.isActive) throw financeError(400, "ACCOUNT_INACTIVE", `${a.code} ${a.name} is archived`);
  }
  // A non-owner partner's accounts move only through shares and Treasury, where what they are owed is checked — never by
  // a hand-written journal (drafted, edited, posted or a correction).
  if (spec.kind === "MANUAL" || spec.kind === "CORRECTION") {
    const owned = await tx.partner.findFirst({ where: { businessId: business.id, role: { not: "OWNER" }, OR: [{ currentAccountId: { in: accountIds } }, { capitalAccountId: { in: accountIds } }] }, select: { name: true } });
    if (owned) throw financeError(409, "PARTNER_ACCOUNT_OWNED", `${owned.name}'s accounts change only through profit shares and money movements, not a journal`);
  }
  const brandIds = [...new Set([spec.brandId, ...spec.lines.map((l) => l.brandId)].filter((b): b is string => Boolean(b)))];
  if (brandIds.length) {
    const found = await tx.financeBrand.count({ where: { id: { in: brandIds }, businessId: business.id } });
    if (found !== brandIds.length) throw financeError(400, "BRAND_NOT_FOUND", "A brand on this journal doesn't belong to the business");
  }

  if (forPosting) {
    if (!business.openingDate) throw financeError(409, "OPENING_DATE_NOT_SET", "Set the Financial Opening Date before posting");
    if (spec.kind === "OPENING_BALANCE") {
      if (spec.entryDate !== business.openingDate) throw financeError(400, "OPENING_DATE_MISMATCH", `Opening balances are dated on the opening date (${business.openingDate})`);
    } else if (compareBusinessDates(spec.entryDate, business.openingDate) < 0) {
      throw financeError(409, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}; nothing posts before it`, { openingDate: business.openingDate });
    }
  }
  const period = await ensurePeriod(tx, business, spec.entryDate, actor);
  if (forPosting) {
    if (period.status === "CLOSED") throw financeError(409, "PERIOD_CLOSED", `The period starting ${businessDateOf(period.startDate)} is closed`);
    if (period.status === "SOFT_CLOSED" && !actorCan(actor, "finance.period_close")) {
      throw financeError(409, "PERIOD_SOFT_CLOSED", `The period starting ${businessDateOf(period.startDate)} is soft-closed; only a period closer may post into it`);
    }
  }
  return { period, totalDebit: check.totalDebit, totalCredit: check.totalCredit };
}

function lineRows(spec: JournalSpec, currency: string) {
  return spec.lines.map((l, i) => ({
    lineNo: i + 1,
    accountId: l.accountId,
    debit: toDecimal(l.debit, currency),
    credit: toDecimal(l.credit, currency),
    brandId: l.brandId ?? null,
    memo: l.memo ?? null,
    partyType: l.partyType ?? null,
    partyId: l.partyId ?? null,
    valuationStatus: l.valuationStatus ?? null,
  }));
}

async function nextJournalNumber(tx: AppTransactionClient, businessId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ number: number }>>`
    INSERT INTO "FinanceSequence" ("businessId", "name", "next") VALUES (${businessId}, 'journal', 2)
    ON CONFLICT ("businessId", "name") DO UPDATE SET "next" = "FinanceSequence"."next" + 1
    RETURNING ("next" - 1)::int AS "number"`;
  return rows[0]!.number;
}

const adminId = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

async function findByKey(tx: AppTransactionClient, businessId: string, key: string) {
  return tx.journalEntry.findUnique({ where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } }, include: ENTRY_INCLUDE });
}

async function lockKey(tx: AppTransactionClient, businessId: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-journal:${businessId}:${key}`}))`;
}

/**
 * Creates AND posts a journal inside the caller's transaction — the entry point for system postings (events, opening
 * balances, reversals, corrections). Idempotent by `spec.idempotencyKey`: a repeat with the same content returns the
 * existing entry (`replayed: true`); different content under the same key is a 409.
 */
export async function postJournalInTx(tx: AppTransactionClient, business: FinanceBusinessInfo, spec: JournalSpec, actor: FinanceActor): Promise<{ entry: EntryRow; replayed: boolean }> {
  const fingerprint = fingerprintOf(spec, business.baseCurrency);
  if (spec.idempotencyKey) {
    await lockKey(tx, business.id, spec.idempotencyKey);
    const existing = await findByKey(tx, business.id, spec.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different journal", { entryId: existing.id });
      }
      if (existing.status === "POSTED") return { entry: existing, replayed: true };
    }
  }
  const { period, totalDebit, totalCredit } = await validateSpec(tx, business, spec, actor, true);
  const draft = await tx.journalEntry.create({
    data: {
      businessId: business.id,
      brandId: spec.brandId ?? null,
      entryDate: dateColumn(spec.entryDate),
      periodId: period.id,
      kind: spec.kind,
      description: spec.description,
      reference: spec.reference ?? null,
      currency: business.baseCurrency,
      totalDebit: toDecimal(totalDebit, business.baseCurrency),
      totalCredit: toDecimal(totalCredit, business.baseCurrency),
      sourceType: spec.sourceType ?? null,
      sourceId: spec.sourceId ?? null,
      financialEventId: spec.financialEventId ?? null,
      idempotencyKey: spec.idempotencyKey ?? null,
      fingerprint: spec.idempotencyKey ? fingerprint : null,
      reversesEntryId: spec.reversesEntryId ?? null,
      correctsEntryId: spec.correctsEntryId ?? null,
      reason: spec.reason ?? null,
      createdByAdminId: adminId(actor),
      lines: { create: lineRows(spec, business.baseCurrency) },
    },
  });
  const posted = await tx.journalEntry.update({
    where: { id: draft.id },
    data: { status: "POSTED", number: await nextJournalNumber(tx, business.id), postedAt: new Date(), postedByAdminId: adminId(actor) },
    include: ENTRY_INCLUDE,
  });
  await recordFinanceAudit(tx, {
    businessId: business.id,
    actor,
    action: spec.kind === "REVERSAL" ? "journal.post_reversal" : spec.kind === "CORRECTION" ? "journal.post_correction" : "journal.post",
    entityType: "JournalEntry",
    entityId: posted.id,
    after: journalDto(posted),
    reason: spec.reason ?? null,
    sourceType: spec.sourceType ?? null,
    sourceRef: spec.sourceId ?? spec.idempotencyKey ?? null,
  });
  return { entry: posted, replayed: false };
}

const inTransaction = financeTransaction;

/** Manual journal — create a DRAFT (optionally idempotent by an Idempotency-Key). */
export async function createDraftJournal(input: { entryDate: string; description: string; reference?: string | null; brandId?: string | null; lines: JournalLineInput[] }, actor: FinanceActor, idempotencyKey?: string | null) {
  const { business } = await getFinanceContext();
  const spec: JournalSpec = { ...input, kind: "MANUAL", sourceType: "MANUAL", lines: linesFromInput(input.lines, business.baseCurrency), idempotencyKey: idempotencyKey ? `request:${idempotencyKey}` : null };
  return inTransaction(async (tx) => {
    const fingerprint = fingerprintOf(spec, business.baseCurrency);
    if (spec.idempotencyKey) {
      await lockKey(tx, business.id, spec.idempotencyKey);
      const existing = await findByKey(tx, business.id, spec.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different journal", { entryId: existing.id });
        return { journal: journalDto(existing), replayed: true };
      }
    }
    const { period, totalDebit, totalCredit } = await validateSpec(tx, business, spec, actor, false);
    const entry = await tx.journalEntry.create({
      data: {
        businessId: business.id,
        brandId: spec.brandId ?? null,
        entryDate: dateColumn(spec.entryDate),
        periodId: period.id,
        kind: "MANUAL",
        description: spec.description,
        reference: spec.reference ?? null,
        currency: business.baseCurrency,
        totalDebit: toDecimal(totalDebit, business.baseCurrency),
        totalCredit: toDecimal(totalCredit, business.baseCurrency),
        sourceType: "MANUAL",
        idempotencyKey: spec.idempotencyKey,
        fingerprint: spec.idempotencyKey ? fingerprint : null,
        createdByAdminId: adminId(actor),
        lines: { create: lineRows(spec, business.baseCurrency) },
      },
      include: ENTRY_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "journal.create_draft", entityType: "JournalEntry", entityId: entry.id, after: journalDto(entry) });
    return { journal: journalDto(entry), replayed: false };
  });
}

async function lockEntry(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "JournalEntry" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "JOURNAL_NOT_FOUND", "Journal entry not found");
  return tx.journalEntry.findUniqueOrThrow({ where: { id }, include: ENTRY_INCLUDE });
}

export async function updateDraftJournal(id: string, input: { entryDate: string; description: string; reference?: string | null; brandId?: string | null; lines: JournalLineInput[] }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const before = await lockEntry(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "JOURNAL_POSTED", "A posted journal can't be edited; reverse or correct it");
    if (before.kind !== "MANUAL") throw financeError(409, "JOURNAL_NOT_MANUAL", "Only manual drafts can be edited");
    const spec: JournalSpec = { ...input, kind: "MANUAL", lines: linesFromInput(input.lines, business.baseCurrency) };
    const { period, totalDebit, totalCredit } = await validateSpec(tx, business, spec, actor, false);
    await tx.journalLine.deleteMany({ where: { entryId: id } });
    const after = await tx.journalEntry.update({
      where: { id },
      data: {
        entryDate: dateColumn(spec.entryDate),
        periodId: period.id,
        description: spec.description,
        reference: spec.reference ?? null,
        brandId: spec.brandId ?? null,
        totalDebit: toDecimal(totalDebit, business.baseCurrency),
        totalCredit: toDecimal(totalCredit, business.baseCurrency),
        // An edited draft is a different request: its original idempotency key no longer describes it.
        idempotencyKey: null,
        fingerprint: null,
        lines: { create: lineRows(spec, business.baseCurrency) },
      },
      include: ENTRY_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "journal.update_draft", entityType: "JournalEntry", entityId: id, before: journalDto(before), after: journalDto(after) });
    return journalDto(after);
  });
}

export async function deleteDraftJournal(id: string, actor: FinanceActor, reason?: string | null) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const before = await lockEntry(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "JOURNAL_POSTED", "A posted journal can't be deleted; reverse it");
    if (before.kind !== "MANUAL") throw financeError(409, "JOURNAL_NOT_MANUAL", "Only manual drafts can be deleted");
    await tx.journalEntry.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "journal.delete_draft", entityType: "JournalEntry", entityId: id, before: journalDto(before), reason: reason ?? null });
  });
}

/** Posts a DRAFT. Posting an already-posted entry is idempotent (returns it with alreadyPosted). */
export async function postDraftJournal(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const before = await lockEntry(tx, business.id, id);
    if (before.status === "POSTED") return { journal: journalDto(before), alreadyPosted: true };
    const spec: JournalSpec = {
      entryDate: businessDateOf(before.entryDate),
      description: before.description,
      kind: before.kind,
      brandId: before.brandId,
      lines: before.lines.map((l) => ({ ...l, debit: toMinor(l.debit, business.baseCurrency), credit: toMinor(l.credit, business.baseCurrency) })),
    };
    const { period } = await validateSpec(tx, business, spec, actor, true);
    const after = await tx.journalEntry.update({
      where: { id },
      data: { status: "POSTED", periodId: period.id, number: await nextJournalNumber(tx, business.id), postedAt: new Date(), postedByAdminId: adminId(actor) },
      include: ENTRY_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "journal.post", entityType: "JournalEntry", entityId: id, before: journalDto(before), after: journalDto(after) });
    return { journal: journalDto(after), alreadyPosted: false };
  });
}

async function reversalSpec(tx: AppTransactionClient, business: FinanceBusinessInfo, original: EntryRow, reason: string, reversalDate: string): Promise<JournalSpec> {
  if (original.status !== "POSTED") throw financeError(409, "JOURNAL_NOT_POSTED", "Only a posted journal can be reversed; delete the draft instead");
  if (original.kind === "REVERSAL") throw financeError(409, "REVERSAL_OF_REVERSAL", "A reversal can't be reversed; post a new journal instead");
  if (compareBusinessDates(reversalDate, businessDateOf(original.entryDate)) < 0) {
    throw financeError(400, "REVERSAL_BEFORE_ORIGINAL", "A reversal can't be dated before the entry it reverses");
  }
  return {
    entryDate: reversalDate,
    description: `Reversal of #${original.number}: ${original.description}`.slice(0, 300),
    reference: original.reference,
    brandId: original.brandId,
    kind: "REVERSAL",
    sourceType: "JournalEntry",
    sourceId: original.id,
    reversesEntryId: original.id,
    idempotencyKey: `reversal:${original.id}`,
    reason,
    lines: reverseLines(
      original.lines.map((l) => ({
        accountId: l.accountId,
        debit: toMinor(l.debit, business.baseCurrency),
        credit: toMinor(l.credit, business.baseCurrency),
        brandId: l.brandId,
        memo: l.memo,
        partyType: l.partyType,
        partyId: l.partyId,
        valuationStatus: l.valuationStatus,
      })),
    ),
  };
}

async function postReversal(tx: AppTransactionClient, business: FinanceBusinessInfo, id: string, reason: string, reversalDate: string | undefined, actor: FinanceActor, owner: "treasury" | "partner-adjustment" | null = null) {
  const original = await lockEntry(tx, business.id, id);
  // A journal that belongs to a treasury movement is reversed through the movement, so the two never disagree.
  if (original.kind === "TREASURY" && owner !== "treasury") {
    throw financeError(409, "JOURNAL_OWNED_BY_MOVEMENT", "This journal belongs to a money movement — reverse the movement instead", { sourceId: original.sourceId });
  }
  // Anything on a partner's accounts is undone only through a correction (partner-adjustments), where the evidence is
  // linked and what they are owed is checked — never by reversing or correcting the journal here.
  if (owner === null) {
    const accountIds = original.lines.map((l) => l.accountId);
    const partner = await tx.partner.findFirst({ where: { businessId: business.id, role: { not: "OWNER" }, OR: [{ currentAccountId: { in: accountIds } }, { capitalAccountId: { in: accountIds } }] }, select: { name: true } });
    if (partner) {
      throw original.kind === "EVENT"
        ? financeError(409, "JOURNAL_OWNED_BY_PROFIT_SHARE", `This journal is ${partner.name}'s profit share — correct it from Owner & partners (a duplicate or wrong posting)`, { entryId: original.id })
        : financeError(409, "PARTNER_ACCOUNT_OWNED", `This journal touches ${partner.name}'s accounts — correct it from Owner & partners`, { entryId: original.id });
    }
  }
  const date = reversalDate ?? (compareBusinessDates(businessToday(business), businessDateOf(original.entryDate)) < 0 ? businessDateOf(original.entryDate) : businessToday(business));
  const spec = await reversalSpec(tx, business, original, reason, date);
  if (original.reversedBy) {
    // The same reversal request again is answered with the reversal it made; anything else is a conflict.
    const existing = await findByKey(tx, business.id, `reversal:${original.id}`);
    if (existing && existing.fingerprint === fingerprintOf(spec, business.baseCurrency)) return { original, reversal: existing, replayed: true };
    throw financeError(409, "ALREADY_REVERSED", `Journal #${original.number} is already reversed`, { reversalId: original.reversedBy.id });
  }
  const { entry, replayed } = await postJournalInTx(tx, business, spec, actor);
  await recordFinanceAudit(tx, { businessId: business.id, actor, action: "journal.reversed", entityType: "JournalEntry", entityId: original.id, reason, sourceRef: entry.id });
  return { original, reversal: entry, replayed };
}

/** In-transaction reversal for finance services that own a posted journal (treasury movements). Same rules as
 * reverseJournal: mirror image, idempotent per original, never a reversal of a reversal. */
export async function reverseJournalInTx(tx: AppTransactionClient, business: FinanceBusinessInfo, id: string, reason: string, reversalDate: string | undefined, actor: FinanceActor) {
  const { reversal, replayed } = await postReversal(tx, business, id, reason, reversalDate, actor, "treasury");
  return { reversal, replayed };
}

/** The partner-adjustments service's own reversal of a journal on a partner's account (a duplicate or wrong posting),
 * after it has checked the evidence and what the partner is owed. */
export async function reversePartnerEntryInTx(tx: AppTransactionClient, business: FinanceBusinessInfo, id: string, reason: string, actor: FinanceActor) {
  const { reversal, replayed } = await postReversal(tx, business, id, reason, undefined, actor, "partner-adjustment");
  return { reversal, replayed };
}

/** Reverses a posted journal with a new, mirror-image journal. Idempotent per original entry. */
export async function reverseJournal(id: string, input: { reason: string; reversalDate?: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const { reversal, replayed } = await postReversal(tx, business, id, input.reason, input.reversalDate, actor);
    return { reversal: journalDto(await tx.journalEntry.findUniqueOrThrow({ where: { id: reversal.id }, include: ENTRY_INCLUDE })), replayed };
  });
}

/** Original → Reversal → Corrected entry, in one transaction. Idempotent per original entry. */
export async function correctJournal(id: string, input: { reason: string; entryDate?: string; description?: string; lines: JournalLineInput[] }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const { original, reversal, replayed: reversalReplayed } = await postReversal(tx, business, id, input.reason, input.entryDate, actor);
    const spec: JournalSpec = {
      entryDate: input.entryDate ?? businessDateOf(reversal.entryDate),
      description: input.description ?? `Correction of #${original.number}: ${original.description}`.slice(0, 300),
      reference: original.reference,
      brandId: original.brandId,
      kind: "CORRECTION",
      sourceType: "JournalEntry",
      sourceId: original.id,
      correctsEntryId: original.id,
      idempotencyKey: `correction:${original.id}`,
      reason: input.reason,
      lines: linesFromInput(input.lines, business.baseCurrency),
    };
    const { entry: corrected, replayed } = await postJournalInTx(tx, business, spec, actor);
    const reload = (eid: string) => tx.journalEntry.findUniqueOrThrow({ where: { id: eid }, include: ENTRY_INCLUDE }).then(journalDto);
    return { reversal: await reload(reversal.id), correction: await reload(corrected.id), replayed: replayed && reversalReplayed };
  });
}

/** Lines on ownership / partner / payroll accounts keep their account but not their amount for a viewer without
 * finance.sensitive (Phase 3 §11). */
async function redact<T extends JournalDto>(businessId: string, journals: T[], viewer: FinanceViewer): Promise<T[]> {
  if (viewer.sensitive) return journals;
  const sensitive = new Set((await prisma.ledgerAccount.findMany({ where: { businessId, isSensitive: true }, select: { id: true } })).map((a) => a.id));
  if (!sensitive.size) return journals;
  return journals.map((j) => ({ ...j, lines: j.lines.map((l) => (sensitive.has(l.accountId) ? { ...l, debit: null as never, credit: null as never, restricted: true } : l)) }));
}

export async function getJournal(id: string, viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const entry = await prisma.journalEntry.findFirst({ where: { id, businessId: business.id }, include: ENTRY_INCLUDE });
  if (!entry) throw financeError(404, "JOURNAL_NOT_FOUND", "Journal entry not found");
  return (await redact(business.id, [journalDto(entry)], viewer))[0]!;
}

export async function listJournals(q: { status?: "DRAFT" | "POSTED"; kind?: JournalEntryKind; from?: string; to?: string; accountId?: string; brandId?: string; page: number; pageSize: number }, viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const where: Prisma.JournalEntryWhereInput = {
    businessId: business.id,
    status: q.status,
    kind: q.kind,
    brandId: q.brandId,
    entryDate: q.from || q.to ? { gte: q.from ? dateColumn(q.from) : undefined, lte: q.to ? dateColumn(q.to) : undefined } : undefined,
    lines: q.accountId ? { some: { accountId: q.accountId } } : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.journalEntry.count({ where }),
    prisma.journalEntry.findMany({ where, include: ENTRY_INCLUDE, orderBy: [{ entryDate: "desc" }, { number: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, journals: await redact(business.id, rows.map(journalDto), viewer) };
}
