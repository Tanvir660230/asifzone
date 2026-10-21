/**
 * Financial accounts: where money is held — cash, bank, bKash/Nagad, gateway and courier clearing (Phase 1), with their
 * Phase 2 bank / wallet details (docs/FINANCE_PHASE_2.md §2). Each one owns a ledger account created under its kind's
 * group (mapping `group.*`); its balance IS that account's ledger balance — computed from posted journal lines, never
 * stored. Nothing here is a credential: no passwords, PINs or keys (the metadata schema refuses such keys).
 */
import type { FinancialAccount, FinancialAccountKind, LedgerAccount, Prisma } from "@prisma/client";
import { CREDENTIAL_LIKE_KEY, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { financeTransaction } from "./finance-tx";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { resolveMappedAccount } from "./chart.service";
import { accountSums, moneyBalanceAt } from "./ledger.service";
import { businessDateOf, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { movementDto, requestMovementInTx } from "./treasury.service";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

export const GROUP_FOR_KIND: Record<FinancialAccountKind, AccountMappingKey> = {
  CASH: "group.cash",
  BANK: "group.bank",
  MOBILE_WALLET: "group.mobile_wallet",
  PAYMENT_GATEWAY: "group.payment_gateway",
  COURIER: "group.courier",
  OTHER: "group.other_money",
  AD_PLATFORM: "group.ad_platform",
};

/** What a money-account read loads: its ledger account and, for cash, who holds it. */
const ACCOUNT_INCLUDE = { ledgerAccount: true, custodian: { select: { id: true, name: true, email: true } } } satisfies Prisma.FinancialAccountInclude;

const inTransaction = financeTransaction;

/** Opening balance of each account (minor units): its line in the posted opening-balance batch plus a posted (not reversed)
 * opening funding. Both are journals in the ledger — this only says which part of the balance is "opening". */
async function openingBalances(businessId: string, currency: string, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const [lines, fundings] = await Promise.all([
    prisma.openingBalanceLine.findMany({ where: { financialAccountId: { in: ids }, batch: { businessId, status: "POSTED" } }, select: { financialAccountId: true, side: true, amount: true } }),
    prisma.treasuryMovement.findMany({ where: { toFinancialAccountId: { in: ids }, kind: "OPENING_FUNDING", status: "POSTED" }, select: { toFinancialAccountId: true, amount: true } }),
  ]);
  for (const l of lines) out.set(l.financialAccountId!, (out.get(l.financialAccountId!) ?? 0) + (l.side === "DEBIT" ? 1 : -1) * toMinor(l.amount, currency));
  for (const f of fundings) out.set(f.toFinancialAccountId!, (out.get(f.toFinancialAccountId!) ?? 0) + toMinor(f.amount, currency));
  return out;
}

type AccountRow = Prisma.FinancialAccountGetPayload<{ include: typeof ACCOUNT_INCLUDE }>;

function dto(f: AccountRow, balanceMinor: number, currency: string, extra: { openingMinor?: number; lastReconciledThrough?: string | null; pendingMovements?: number } = {}) {
  const major = (v: number) => toMajorNumber(v, currency);
  return {
    id: f.id, kind: f.kind, name: f.name, provider: f.provider, accountNumberLast4: f.accountNumberLast4, currency: f.currency,
    accountTitle: f.accountTitle, branch: f.branch, accountReference: f.accountReference, metadata: f.metadata,
    approvalThreshold: f.approvalThreshold === null ? null : major(toMinor(f.approvalThreshold, currency)),
    brandId: f.brandId, isActive: f.isActive, status: f.isActive ? ("ACTIVE" as const) : ("INACTIVE" as const),
    /** Owner's books §2: the person holding this cash (null for banks, wallets and clearing accounts). */
    custodian: f.custodian,
    ledgerAccount: { id: f.ledgerAccount.id, code: f.ledgerAccount.code, name: f.ledgerAccount.name },
    /** The ledger balance (derived — there is no stored balance). */
    balance: major(balanceMinor),
    currentBalance: major(balanceMinor),
    openingBalance: major(extra.openingMinor ?? 0),
    reconciliationStartDate: f.reconciliationStartDate ? businessDateOf(f.reconciliationStartDate) : null,
    lastReconciledThrough: extra.lastReconciledThrough ?? null,
    pendingMovements: extra.pendingMovements ?? 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

export async function listFinancialAccounts(q: { brandId?: string; kind?: FinancialAccountKind } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const [rows, sums] = await Promise.all([
    prisma.financialAccount.findMany({ where: { businessId: business.id, brandId: q.brandId, kind: q.kind }, include: ACCOUNT_INCLUDE, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    accountSums(business.id, {}),
  ]);
  const byAccount = new Map(sums.map((s) => [s.accountId, toMinor(s.periodDebit, cur) - toMinor(s.periodCredit, cur)]));
  const ids = rows.map((r) => r.id);
  const [opening, lastRuns, pending] = await Promise.all([
    openingBalances(business.id, cur, ids),
    prisma.bankReconciliation.groupBy({ by: ["financialAccountId"], where: { financialAccountId: { in: ids }, status: "COMPLETED" }, _max: { periodEnd: true } }),
    prisma.treasuryMovement.findMany({ where: { businessId: business.id, status: "PENDING_APPROVAL" }, select: { fromFinancialAccountId: true, toFinancialAccountId: true } }),
  ]);
  const last = new Map(lastRuns.map((r) => [r.financialAccountId, r._max.periodEnd ? businessDateOf(r._max.periodEnd) : null]));
  const pendingBy = new Map<string, number>();
  for (const p of pending) for (const id of new Set([p.fromFinancialAccountId, p.toFinancialAccountId])) if (id) pendingBy.set(id, (pendingBy.get(id) ?? 0) + 1);
  return rows.map((r) => dto(r, byAccount.get(r.ledgerAccountId) ?? 0, cur, { openingMinor: opening.get(r.id), lastReconciledThrough: last.get(r.id), pendingMovements: pendingBy.get(r.id) }));
}

export async function getFinancialAccount(id: string) {
  const { business } = await getFinanceContext();
  const row = await prisma.financialAccount.findFirst({ where: { id, businessId: business.id }, select: { id: true } });
  if (!row) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Financial account not found");
  const [account] = (await listFinancialAccounts()).filter((a) => a.id === id);
  return account!;
}

/** The next free child code under a group: 1100 → 1101, 1102, … (numeric codes; else `<parent>-<n>`). */
async function nextChildCode(tx: AppTransactionClient, businessId: string, parent: LedgerAccount): Promise<string> {
  const children = await tx.ledgerAccount.findMany({ where: { businessId, parentId: parent.id }, select: { code: true } });
  const taken = new Set((await tx.ledgerAccount.findMany({ where: { businessId }, select: { code: true } })).map((a) => a.code));
  if (/^\d+$/.test(parent.code)) {
    const base = Number(parent.code);
    const used = children.map((c) => Number(c.code)).filter((n) => Number.isInteger(n) && n > base);
    for (let n = Math.max(base, ...used) + 1; n < base + 100; n++) if (!taken.has(String(n))) return String(n);
  }
  for (let n = children.length + 1; n < 10_000; n++) if (!taken.has(`${parent.code}-${n}`)) return `${parent.code}-${n}`;
  throw financeError(409, "NO_FREE_CODE", `No free account code under ${parent.code}`);
}

export interface FinancialAccountDetails {
  accountTitle?: string | null;
  branch?: string | null;
  accountReference?: string | null;
  metadata?: Record<string, string | number | boolean | null> | null;
  approvalThreshold?: number | null;
}

function detailsData(input: FinancialAccountDetails, currency: string) {
  if (input.metadata && Object.keys(input.metadata).some((k) => CREDENTIAL_LIKE_KEY.test(k))) {
    throw financeError(400, "CREDENTIALS_NOT_ALLOWED", "Account details must never hold a password, PIN, secret or key");
  }
  return {
    ...(input.accountTitle !== undefined ? { accountTitle: input.accountTitle } : {}),
    ...(input.branch !== undefined ? { branch: input.branch } : {}),
    ...(input.accountReference !== undefined ? { accountReference: input.accountReference } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata === null ? (null as unknown as Prisma.InputJsonValue) : (input.metadata as Prisma.InputJsonValue) } : {}),
    ...(input.approvalThreshold !== undefined ? { approvalThreshold: input.approvalThreshold === null ? null : toDecimal(toMinor(input.approvalThreshold, currency), currency) } : {}),
  };
}

/** Creates a financial account and its own ledger account under its kind's group, in the caller's transaction, audited.
 * Used by the API and by commerce provisioning (Phase 3 clearing accounts) — one way to make a money account. */
export async function createFinancialAccountInTx(
  tx: AppTransactionClient,
  business: Pick<FinanceBusinessInfo, "id" | "baseCurrency">,
  input: { kind: FinancialAccountKind; name: string; provider?: string | null; accountNumberLast4?: string | null; brandId?: string | null } & FinancialAccountDetails,
  actor: FinanceActor,
) {
  if (await tx.financialAccount.findUnique({ where: { businessId_name: { businessId: business.id, name: input.name } } })) {
    throw financeError(409, "FINANCIAL_ACCOUNT_NAME_TAKEN", `A financial account named "${input.name}" already exists`);
  }
  if (input.brandId && !(await tx.financeBrand.findFirst({ where: { id: input.brandId, businessId: business.id } }))) {
    throw financeError(400, "BRAND_NOT_FOUND", "Brand not found in this business");
  }
  // An ad account lives under a group the owner's-books set-up adds to older charts.
  if (input.kind === "AD_PLATFORM") await ensureOwnerBooksSetupInTx(tx, business, actor);
  const group = await resolveMappedAccount(tx, business.id, GROUP_FOR_KIND[input.kind]);
  const ledgerAccount = await tx.ledgerAccount.create({
    data: { businessId: business.id, code: await nextChildCode(tx, business.id, group), name: input.name, type: group.type, normalBalance: "DEBIT", parentId: group.id, isPostable: true, isSystem: true },
  });
  const account = await tx.financialAccount.create({
    data: {
      businessId: business.id, brandId: input.brandId ?? null, kind: input.kind, name: input.name, provider: input.provider ?? null, accountNumberLast4: input.accountNumberLast4 ?? null,
      currency: business.baseCurrency, ledgerAccountId: ledgerAccount.id, ...detailsData(input, business.baseCurrency),
    },
    include: { ledgerAccount: true },
  });
  await recordFinanceAudit(tx, [
    { businessId: business.id, actor, action: "account.create", entityType: "LedgerAccount", entityId: ledgerAccount.id, after: ledgerAccount, sourceType: "FinancialAccount", sourceRef: account.id },
    { businessId: business.id, actor, action: "financial_account.create", entityType: "FinancialAccount", entityId: account.id, after: account },
  ]);
  return account;
}

export async function createFinancialAccount(
  input: { kind: FinancialAccountKind; name: string; provider?: string | null; accountNumberLast4?: string | null; brandId?: string | null; openingBalance?: { amount: number; date: string } | null } & FinancialAccountDetails,
  actor: FinanceActor,
) {
  const { business } = await getFinanceContext();
  const created = await inTransaction(async (tx) => {
    const account = await createFinancialAccountInTx(tx, business, input, actor);
    let openingMovement = null;
    if (input.openingBalance) {
      const { movement } = await requestMovementInTx(tx, business, {
        kind: "OPENING_FUNDING",
        movementDate: input.openingBalance.date,
        amount: input.openingBalance.amount,
        description: `Opening balance of ${account.name}`,
        toFinancialAccountId: account.id,
      }, actor, `opening-funding:${account.id}`);
      openingMovement = movementDto(movement);
    }
    return { account, openingMovement };
  });
  return { ...(await getFinancialAccount(created.account.id)), openingMovement: created.openingMovement };
}

export async function updateFinancialAccount(id: string, input: { name?: string; provider?: string | null; accountNumberLast4?: string | null; isActive?: boolean; reason?: string | null } & FinancialAccountDetails, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  await inTransaction(async (tx) => {
    const before = await tx.financialAccount.findFirst({ where: { id, businessId: business.id }, include: { ledgerAccount: true } });
    if (!before) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Financial account not found");
    if (input.isActive === false && before.isActive) {
      const balance = await moneyBalanceAt(tx, business.id, before.ledgerAccountId, cur, null);
      if (balance !== 0) throw financeError(409, "FINANCIAL_ACCOUNT_HAS_BALANCE", "Transfer the balance out before deactivating this account", { balance: toMajorNumber(balance, cur) });
      const pending = await tx.treasuryMovement.count({ where: { status: "PENDING_APPROVAL", OR: [{ fromFinancialAccountId: id }, { toFinancialAccountId: id }] } });
      if (pending) throw financeError(409, "FINANCIAL_ACCOUNT_HAS_PENDING", "Approve or reject this account's pending movements first");
      if (await tx.bankReconciliation.count({ where: { financialAccountId: id, status: "IN_PROGRESS" } })) {
        throw financeError(409, "FINANCIAL_ACCOUNT_RECONCILING", "Finish or abandon this account's reconciliation first");
      }
    }
    if (input.name && input.name !== before.name && (await tx.financialAccount.findUnique({ where: { businessId_name: { businessId: business.id, name: input.name } } }))) {
      throw financeError(409, "FINANCIAL_ACCOUNT_NAME_TAKEN", `A financial account named "${input.name}" already exists`);
    }
    const after = await tx.financialAccount.update({
      where: { id },
      data: { name: input.name, provider: input.provider, accountNumberLast4: input.accountNumberLast4, isActive: input.isActive, ...detailsData(input, cur) },
      include: { ledgerAccount: true },
    });
    const ledgerChanges = { name: input.name !== undefined && input.name !== before.ledgerAccount.name ? input.name : undefined, isActive: input.isActive !== undefined && input.isActive !== before.ledgerAccount.isActive ? input.isActive : undefined };
    const audit = [{ businessId: business.id, actor, action: "financial_account.update", entityType: "FinancialAccount", entityId: id, before, after, reason: input.reason }];
    if (ledgerChanges.name !== undefined || ledgerChanges.isActive !== undefined) {
      const ledgerAfter = await tx.ledgerAccount.update({ where: { id: before.ledgerAccountId }, data: ledgerChanges });
      audit.push({ businessId: business.id, actor, action: "account.update", entityType: "LedgerAccount", entityId: before.ledgerAccountId, before: before.ledgerAccount as never, after: ledgerAfter as never, reason: input.reason });
    }
    await recordFinanceAudit(tx, audit);
  });
  return getFinancialAccount(id);
}
