/**
 * Autopilot (docs/FINANCE_OWNER_BOOKS.md §15): what the owner would otherwise do by hand, done every night.
 *
 * 1. Steadfast payouts: new payouts are brought in from Steadfast into the chosen account. A payout is posted when every
 *    parcel in it is accounted for: matched to its order, or booked straight on Steadfast's panel (no invoice number —
 *    a sale outside the website). A parcel with our invoice number that matches no order waits for a person.
 * 2. The owner keeps the payouts: each posted payout into that account becomes his drawing on the payout's day.
 * 3. Meta ad spend: the last 7 days are read again when Meta is connected (Meta revises recent days).
 * 4. Partners' profit shares: every finished month is shared once the books have started.
 *
 * Each step runs on its own: one failing never stops the others. Every step is idempotent, so a run can be repeated.
 */
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { financeError, toMajorNumber, toMinor } from "./finance-values";
import { booksStarted } from "./finance-facts";
import { importCourierPayouts } from "./courier-payouts.service";
import { getSettlement, markUnmatchedAsOutsideSales, postSettlement } from "./settlements.service";
import { markPayoutsTaken, runProfitShares } from "./partner-profit.service";
import { importMetaSpend } from "./ads.service";
import { getProviders } from "../../providers/registry";
import { liveProvidersEnabled } from "../../lib/provider-guard";

export const AUTOPILOT_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:autopilot" };

const PAYING_KINDS = ["BANK", "MOBILE_WALLET", "CASH"];

type Step = { ok: boolean; skipped?: string; error?: string; [k: string]: unknown };
export interface AutopilotRun { at: string; payouts: Step; ownerDrawings: Step; adSpend: Step; profitShares: Step }

export async function getAutopilotSettings() {
  const { business } = await getFinanceContext();
  const b = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { autoPayoutAccountId: true, autoPayoutsToOwner: true, autoProfitShares: true, autopilotLastRun: true } });
  const account = b.autoPayoutAccountId ? await prisma.financialAccount.findFirst({ where: { id: b.autoPayoutAccountId }, select: { id: true, name: true, kind: true } }) : null;
  return {
    payoutAccount: account,
    payoutsToOwner: b.autoPayoutsToOwner,
    profitShares: b.autoProfitShares,
    metaConnected: getProviders().adSpend.configured(),
    lastRun: (b.autopilotLastRun ?? null) as AutopilotRun | null,
  };
}

export async function updateAutopilotSettings(input: { payoutAccountId?: string | null; payoutsToOwner?: boolean; profitShares?: boolean }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  if (input.payoutAccountId) {
    const fa = await prisma.financialAccount.findFirst({ where: { id: input.payoutAccountId, businessId: business.id, isActive: true } });
    if (!fa || !PAYING_KINDS.includes(fa.kind)) throw financeError(400, "PAYOUT_DESTINATION", "Choose the bank, bKash or cash account Steadfast pays into");
  }
  await financeTransaction(async (tx) => {
    const before = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { autoPayoutAccountId: true, autoPayoutsToOwner: true, autoProfitShares: true } });
    const after = await tx.financeBusiness.update({
      where: { id: business.id },
      data: {
        ...(input.payoutAccountId !== undefined ? { autoPayoutAccountId: input.payoutAccountId } : {}),
        ...(input.payoutsToOwner !== undefined ? { autoPayoutsToOwner: input.payoutsToOwner } : {}),
        ...(input.profitShares !== undefined ? { autoProfitShares: input.profitShares } : {}),
      },
      select: { autoPayoutAccountId: true, autoPayoutsToOwner: true, autoProfitShares: true },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "finance_autopilot.settings", entityType: "FinanceBusiness", entityId: business.id, before, after });
  });
  return getAutopilotSettings();
}

const failed = (err: unknown): Step => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

/** Is every parcel of a draft payout accounted for — matched, or booked on the courier's panel (no invoice)? */
async function postable(id: string) {
  const s = await getSettlement(id);
  const open = s.lines.filter((l) => l.matchStatus === "UNMATCHED" && !l.outsideSale);
  return { outside: open.filter((l) => !l.orderNumber).length, unknown: open.filter((l) => l.orderNumber).length };
}

async function payoutStep(accountId: string | null, actor: FinanceActor): Promise<Step> {
  if (!accountId) return { ok: true, skipped: "OFF" };
  if (!liveProvidersEnabled()) return { ok: true, skipped: "LIVE_PROVIDERS_OFF" };
  try {
    const r = await importCourierPayouts({ destinationFinancialAccountId: accountId }, actor);
    const { business } = await getFinanceContext();
    const drafts = await prisma.clearingSettlement.findMany({ where: { businessId: business.id, status: "DRAFT", destinationFinancialAccountId: accountId, reference: { startsWith: "steadfast:" } }, orderBy: { settlementDate: "asc" }, select: { id: true, reference: true } });
    const posted: string[] = [];
    const waiting: Array<{ reference: string; parcels: number }> = [];
    for (const d of drafts) {
      const p = await postable(d.id);
      if (p.unknown) {
        waiting.push({ reference: d.reference, parcels: p.unknown });
        continue;
      }
      if (p.outside) await markUnmatchedAsOutsideSales(d.id, actor);
      await postSettlement(d.id, actor);
      posted.push(d.reference);
    }
    return { ok: true, imported: r.imported.length, problems: r.problems, posted, waiting };
  } catch (err) {
    return failed(err);
  }
}

async function ownerStep(accountId: string | null, on: boolean, actor: FinanceActor): Promise<Step> {
  if (!on || !accountId) return { ok: true, skipped: "OFF" };
  try {
    const { business } = await getFinanceContext();
    const cur = business.baseCurrency;
    const rows = await prisma.clearingSettlement.findMany({ where: { businessId: business.id, status: "POSTED", destinationFinancialAccountId: accountId }, select: { id: true, netAmount: true } });
    const taken = new Set((await prisma.treasuryMovement.findMany({ where: { businessId: business.id, idempotencyKey: { in: rows.map((r) => `request:owner-took-payout:${r.id}`) } }, select: { idempotencyKey: true } })).map((m) => m.idempotencyKey));
    const open = rows.filter((r) => !taken.has(`request:owner-took-payout:${r.id}`));
    if (!open.length) return { ok: true, taken: 0, amount: 0 };
    const r = await markPayoutsTaken(open.map((o) => o.id), actor);
    return { ok: true, taken: r.taken.length, amount: toMajorNumber(open.reduce((s, o) => s + toMinor(o.netAmount, cur), 0), cur) };
  } catch (err) {
    return failed(err);
  }
}

async function adStep(actor: FinanceActor): Promise<Step> {
  if (!getProviders().adSpend.configured()) return { ok: true, skipped: "META_NOT_CONNECTED" };
  if (!liveProvidersEnabled()) return { ok: true, skipped: "LIVE_PROVIDERS_OFF" };
  try {
    const r = await importMetaSpend({ days: 7 }, actor);
    const errors = r.accounts.filter((a) => a.error).map((a) => `${a.adAccountId}: ${a.error}`);
    return { ok: errors.length === 0, days: r.accounts.reduce((s, a) => s + a.days, 0), ...(errors.length ? { error: errors.join("; ") } : {}) };
  } catch (err) {
    return failed(err);
  }
}

async function shareStep(on: boolean, actor: FinanceActor): Promise<Step> {
  if (!on) return { ok: true, skipped: "OFF" };
  try {
    if (!(await booksStarted(await getFinanceContext()))) return { ok: true, skipped: "BOOKS_NOT_STARTED" };
    const r = await runProfitShares({}, actor);
    return { ok: true, shared: r.shared };
  } catch (err) {
    return failed(err);
  }
}

/** One run: every step, in order (payouts before drawings), then the result kept for the settings page. */
export async function runAutopilot(actor: FinanceActor = AUTOPILOT_ACTOR): Promise<AutopilotRun> {
  const { business } = await getFinanceContext();
  const b = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { autoPayoutAccountId: true, autoPayoutsToOwner: true, autoProfitShares: true } });
  const payouts = await payoutStep(b.autoPayoutAccountId, actor);
  const ownerDrawings = await ownerStep(b.autoPayoutAccountId, b.autoPayoutsToOwner, actor);
  const adSpend = await adStep(actor);
  const profitShares = await shareStep(b.autoProfitShares, actor);
  const run: AutopilotRun = { at: new Date().toISOString(), payouts, ownerDrawings, adSpend, profitShares };
  await financeTransaction(async (tx) => {
    await tx.financeBusiness.update({ where: { id: business.id }, data: { autopilotLastRun: run as never } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "finance_autopilot.run", entityType: "FinanceBusiness", entityId: business.id, after: run });
  });
  return run;
}
