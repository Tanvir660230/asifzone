/**
 * The one check on money leaving a partner (partner finance plan §6, payment safety). A non-owner
 * partner's current account (32xx) holds what the business owes them; their capital account (31xx) what they put in.
 * Anything that DEBITS either one — a payment, an adjustment out, a capital return, or the reversal of a deposit — must fit
 * in what is there now, less what is already waiting for approval:
 *
 *   available = posted balance − pending (PENDING_APPROVAL withdrawals / adjustments out against that account)
 *
 * The check runs under a per-partner lock inside the caller's transaction, when a movement is requested, when it is posted
 * or approved, and when a deposit is reversed — so two requests can't both spend the same balance. The owner's own
 * accounts (3100 / 3300) are never limited here: drawings are not a payable.
 */
import type { Partner, TreasuryMovementKind } from "@prisma/client";
import type { AppTransactionClient } from "../../config/prisma";
import { actorCan, type FinanceActor } from "./finance-audit";
import { financeError, toMajorNumber, toMinor } from "./finance-values";

export type PartnerSide = "cur" | "cap";
export interface PartnerAccount { partner: Partner; side: PartnerSide }

/** The non-owner partner whose current or capital account this ledger account is, if any. */
export async function partnerAccountOf(tx: AppTransactionClient, businessId: string, ledgerAccountId: string | null | undefined): Promise<PartnerAccount | null> {
  if (!ledgerAccountId) return null;
  const partner = await tx.partner.findFirst({ where: { businessId, role: { not: "OWNER" }, OR: [{ currentAccountId: ledgerAccountId }, { capitalAccountId: ledgerAccountId }] } });
  if (!partner) return null;
  return { partner, side: partner.currentAccountId === ledgerAccountId ? "cur" : "cap" };
}

/** Whether a movement of this kind puts a DEBIT on its counter account (money going to the partner). */
export const debitsCounter = (kind: TreasuryMovementKind, direction: string | null | undefined) => kind === "WITHDRAWAL" || (kind === "ADJUSTMENT" && direction === "OUT");

/** Touching a partner's balances is the owner's: anything on their current account, and anything taking capital out. */
export function assertMayTouchPartner(actor: FinanceActor, pa: PartnerAccount, debits: boolean) {
  if ((pa.side === "cur" || debits) && !actorCan(actor, "finance.sensitive")) {
    throw financeError(403, "PARTNER_ACCOUNT_SENSITIVE", `Only the owner can move money on ${pa.partner.name}'s ${pa.side === "cur" ? "current" : "capital"} account`);
  }
}

/**
 * An advance: the owner pays a partner beyond what they are owed, on purpose and with a reason (an advance against future
 * shares). It is recorded as its own audit entry on the movement when it is requested — immutable, like every finance audit
 * entry — and only a movement carrying one may take the partner's current account below zero, at request, posting or
 * approval. Future shares credit the account and bring it back up; nothing is ever taken from them automatically.
 */
export const PARTNER_ADVANCE_ACTION = "movement.partner_advance";

export async function isPartnerAdvance(tx: AppTransactionClient, businessId: string, movementId: string) {
  return (await tx.financeAuditEntry.count({ where: { businessId, action: PARTNER_ADVANCE_ACTION, entityType: "TreasuryMovement", entityId: movementId } })) > 0;
}

/** Only the owner (finance.sensitive) may advance, only as a withdrawal to a partner's current account, and with a reason. */
export function assertAdvanceAllowed(actor: FinanceActor, pa: PartnerAccount | null, kind: TreasuryMovementKind, reason: string) {
  if (!pa || pa.side !== "cur" || kind !== "WITHDRAWAL") {
    throw financeError(400, "ADVANCE_NOT_ALLOWED", "Only a payment to a partner's current account can be an advance");
  }
  if (!actorCan(actor, "finance.sensitive")) throw financeError(403, "PARTNER_ACCOUNT_SENSITIVE", `Only the owner can pay ${pa.partner.name} in advance`);
  if (reason.length < 3) throw financeError(400, "ADVANCE_REASON_REQUIRED", "Say why this is paid in advance");
}

export async function lockPartner(tx: AppTransactionClient, partnerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-payable:${partnerId}`}))`;
}

/** Posted balance (credit − debit) and pending debits of one partner account, in minor units. */
export async function partnerAccountState(tx: AppTransactionClient, businessId: string, ledgerAccountId: string, currency: string, excludeMovementId?: string | null) {
  const [lines, pending] = await Promise.all([
    tx.journalLine.aggregate({ where: { accountId: ledgerAccountId, entry: { businessId, status: "POSTED" } }, _sum: { debit: true, credit: true } }),
    tx.treasuryMovement.aggregate({
      where: {
        businessId, counterAccountId: ledgerAccountId, status: "PENDING_APPROVAL",
        OR: [{ kind: "WITHDRAWAL" }, { kind: "ADJUSTMENT", direction: "OUT" }],
        ...(excludeMovementId ? { id: { not: excludeMovementId } } : {}),
      },
      _sum: { amount: true },
    }),
  ]);
  const posted = toMinor(lines._sum.credit ?? 0, currency) - toMinor(lines._sum.debit ?? 0, currency);
  const pendingMinor = toMinor(pending._sum.amount ?? 0, currency);
  return { posted, pending: pendingMinor, available: posted - pendingMinor };
}

/**
 * Refuses a debit of `amountMinor` on a partner account unless it fits in what is available. Takes the partner lock first,
 * so the balance is read after any concurrent request for the same partner has committed. `reversal` picks the codes used
 * when undoing a deposit.
 */
export async function assertPartnerDebit(
  tx: AppTransactionClient,
  business: { id: string; baseCurrency: string },
  input: { pa: PartnerAccount; amountMinor: number; excludeMovementId?: string | null; reversal?: boolean },
) {
  const { pa, amountMinor } = input;
  const cur = business.baseCurrency;
  await lockPartner(tx, pa.partner.id);
  const account = pa.side === "cur" ? pa.partner.currentAccountId : pa.partner.capitalAccountId;
  const s = await partnerAccountState(tx, business.id, account, cur, input.excludeMovementId);
  if (amountMinor <= s.available) return s;
  const m = (v: number) => toMajorNumber(v, cur);
  const figures = pa.side === "cur"
    ? { postedPayable: m(s.posted), pending: m(s.pending), available: m(Math.max(0, s.available)), amount: m(amountMinor) }
    : { capital: m(s.posted), pending: m(s.pending), available: m(Math.max(0, s.available)), amount: m(amountMinor) };
  const name = pa.partner.name;
  if (input.reversal) {
    throw pa.side === "cur"
      ? financeError(409, "REVERSAL_EXCEEDS_AVAILABLE", `Reversing this would leave ${name} owing the business: ${name} is owed ${figures.available} after payments waiting for approval`, figures)
      : financeError(409, "REVERSAL_EXCEEDS_CAPITAL", `Reversing this would take ${name}'s capital below zero: ${figures.available} is left after returns waiting for approval`, figures);
  }
  throw pa.side === "cur"
    ? financeError(409, "PAY_MORE_THAN_AVAILABLE", `${name} can be paid at most ${figures.available} now (owed ${figures.postedPayable}, ${figures.pending} waiting for approval)`, { ...figures, legacyCode: "PAY_MORE_THAN_OWED" })
    : financeError(409, "CAPITAL_RETURN_EXCEEDS", `At most ${figures.available} of ${name}'s capital can be returned now`, figures);
}
