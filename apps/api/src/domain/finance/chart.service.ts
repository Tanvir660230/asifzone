/**
 * Business settings, chart of accounts and account mappings (Phase 1). Every change is audited in its transaction.
 */
import type { LedgerAccount, LedgerAccountType, Prisma } from "@prisma/client";
import { ACCOUNT_MAPPING_KEYS, CLEARING_ACCOUNTS, CLEARING_MAPPING_KEYS, defaultNormalBalance, isAccountMappingKey, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { financeTransaction } from "./finance-tx";
import { getFinanceContext } from "./finance-context";
import { accountSums } from "./ledger.service";
import { businessDateOf, dateColumn, financeError, toMajorNumber, toMinor, FULL_VIEW, type FinanceViewer } from "./finance-values";

const inTransaction = financeTransaction;

// ── business ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function getBusinessSettings() {
  const { business, brand } = await getFinanceContext();
  const [brands, batch, posted] = await Promise.all([
    prisma.financeBrand.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "asc" } }),
    prisma.openingBalanceBatch.findUnique({ where: { businessId: business.id }, select: { status: true } }),
    prisma.journalEntry.count({ where: { businessId: business.id, status: "POSTED" } }),
  ]);
  return {
    business,
    installationBrand: brand,
    brands: brands.map((b) => ({ id: b.id, key: b.key, name: b.name, installId: b.installId, isActive: b.isActive })),
    openingBalancesStatus: batch?.status ?? null,
    postedJournals: posted,
    openingDateLocked: batch?.status === "POSTED" || posted > 0,
    ...(await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { costPolicy: true, inventoryCostingActivatedAt: true, inventoryGainAlertThreshold: true, countLossApprovalThreshold: true } })),
  };
}

export async function updateBusinessSettings(input: { name?: string; fiscalYearStartMonth?: number; openingDate?: string; inventoryGainAlertThreshold?: number; countLossApprovalThreshold?: number; reason?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "FinanceBusiness" WHERE id = ${business.id} FOR UPDATE`;
    const before = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id } });
    const data: Prisma.FinanceBusinessUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.fiscalYearStartMonth !== undefined && input.fiscalYearStartMonth !== before.fiscalYearStartMonth) {
      if (await tx.financialPeriod.count({ where: { businessId: business.id } })) {
        throw financeError(409, "FISCAL_YEAR_LOCKED", "The fiscal year start can't change once periods exist");
      }
      data.fiscalYearStartMonth = input.fiscalYearStartMonth;
    }
    if (input.openingDate !== undefined && input.openingDate !== (before.openingDate ? businessDateOf(before.openingDate) : null)) {
      const [posted, batch] = await Promise.all([
        tx.journalEntry.count({ where: { businessId: business.id, status: "POSTED" } }),
        tx.openingBalanceBatch.findUnique({ where: { businessId: business.id } }),
      ]);
      if (posted > 0 || batch?.status === "POSTED") {
        throw financeError(409, "OPENING_DATE_LOCKED", "The Financial Opening Date is fixed once anything has been posted");
      }
      data.openingDate = dateColumn(input.openingDate);
      if (batch) {
        const updatedBatch = await tx.openingBalanceBatch.update({ where: { id: batch.id }, data: { openingDate: dateColumn(input.openingDate) } });
        await recordFinanceAudit(tx, { businessId: business.id, actor, action: "opening.date_followed", entityType: "OpeningBalanceBatch", entityId: batch.id, before: batch, after: updatedBatch, reason: input.reason });
      }
    }
    if (input.inventoryGainAlertThreshold !== undefined) data.inventoryGainAlertThreshold = input.inventoryGainAlertThreshold;
    if (input.countLossApprovalThreshold !== undefined) data.countLossApprovalThreshold = input.countLossApprovalThreshold;
    if (!Object.keys(data).length) return before;
    const after = await tx.financeBusiness.update({ where: { id: business.id }, data });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "business.update", entityType: "FinanceBusiness", entityId: business.id, before, after, reason: input.reason });
    return after;
  }).then(() => getBusinessSettings());
}

// ── chart of accounts ──────────────────────────────────────────────────────────────────────────────────────────────

export function accountDto(a: LedgerAccount, mappings: string[] = []) {
  return {
    id: a.id, code: a.code, name: a.name, description: a.description, type: a.type, normalBalance: a.normalBalance,
    parentId: a.parentId, isPostable: a.isPostable, isSystem: a.isSystem, isActive: a.isActive, isSensitive: a.isSensitive, mappings,
  };
}

/** The chart as a flat, code-ordered list with each account's current balance (posted, all dates, all brands). */
export async function listAccounts(viewer: FinanceViewer = FULL_VIEW) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const [accounts, mappings, sums] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { businessId: business.id }, orderBy: { code: "asc" } }),
    prisma.accountMapping.findMany({ where: { businessId: business.id } }),
    accountSums(business.id, {}),
  ]);
  const keysByAccount = new Map<string, string[]>();
  for (const m of mappings) keysByAccount.set(m.accountId, [...(keysByAccount.get(m.accountId) ?? []), m.key]);
  const sumByAccount = new Map(sums.map((s) => [s.accountId, s]));
  return accounts.map((a) => {
    const s = sumByAccount.get(a.id);
    const d = s ? toMinor(s.periodDebit, cur) : 0;
    const c = s ? toMinor(s.periodCredit, cur) : 0;
    if (a.isSensitive && !viewer.sensitive) return { ...accountDto(a, keysByAccount.get(a.id)), balance: null, restricted: true };
    return { ...accountDto(a, keysByAccount.get(a.id)), balance: toMajorNumber(a.normalBalance === "DEBIT" ? d - c : c - d, cur), restricted: false };
  });
}

async function assertParent(tx: AppTransactionClient, businessId: string, parentId: string, type: LedgerAccountType, selfId?: string) {
  const parent = await tx.ledgerAccount.findFirst({ where: { id: parentId, businessId } });
  if (!parent) throw financeError(400, "PARENT_NOT_FOUND", "Parent account not found");
  if (parent.isPostable) throw financeError(400, "PARENT_NOT_GROUP", `${parent.code} ${parent.name} takes postings; only a group account can have children`);
  if (parent.type !== type) throw financeError(400, "PARENT_TYPE_MISMATCH", `A ${type} account can't sit under a ${parent.type} group`);
  // No cycles: walk up from the parent.
  let cursor: string | null = parent.id;
  for (let depth = 0; cursor && depth < 50; depth++) {
    if (cursor === selfId) throw financeError(400, "ACCOUNT_CYCLE", "An account can't be placed under its own descendant");
    cursor = (await tx.ledgerAccount.findUnique({ where: { id: cursor }, select: { parentId: true } }))?.parentId ?? null;
  }
}

export async function createAccount(input: { code: string; name: string; description?: string | null; type: LedgerAccountType; parentId?: string | null; isPostable: boolean; normalBalance?: "DEBIT" | "CREDIT" }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    if (await tx.ledgerAccount.findUnique({ where: { businessId_code: { businessId: business.id, code: input.code } } })) {
      throw financeError(409, "ACCOUNT_CODE_TAKEN", `Account code ${input.code} is already used`);
    }
    if (input.parentId) await assertParent(tx, business.id, input.parentId, input.type);
    const account = await tx.ledgerAccount.create({
      data: {
        businessId: business.id, code: input.code, name: input.name, description: input.description ?? null, type: input.type,
        normalBalance: input.normalBalance ?? defaultNormalBalance(input.type), parentId: input.parentId ?? null, isPostable: input.isPostable,
      },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "account.create", entityType: "LedgerAccount", entityId: account.id, after: account });
    return accountDto(account);
  });
}

export async function updateAccount(id: string, input: { name?: string; description?: string | null; parentId?: string | null; isActive?: boolean; reason?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const before = await tx.ledgerAccount.findFirst({ where: { id, businessId: business.id } });
    if (!before) throw financeError(404, "ACCOUNT_NOT_FOUND", "Account not found");
    const data: Prisma.LedgerAccountUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.parentId !== undefined && input.parentId !== before.parentId) {
      if (input.parentId) await assertParent(tx, business.id, input.parentId, before.type, before.id);
      data.parentId = input.parentId;
    }
    if (input.isActive !== undefined && input.isActive !== before.isActive) {
      if (!input.isActive) {
        const mapped = await tx.accountMapping.findMany({ where: { accountId: id }, select: { key: true } });
        if (mapped.length) throw financeError(409, "ACCOUNT_MAPPED", `Move the mapping(s) ${mapped.map((m) => m.key).join(", ")} to another account first`);
        if (await tx.ledgerAccount.count({ where: { parentId: id, isActive: true } })) throw financeError(409, "ACCOUNT_HAS_ACTIVE_CHILDREN", "Archive its child accounts first");
        if (await tx.financialAccount.count({ where: { ledgerAccountId: id, isActive: true } })) throw financeError(409, "ACCOUNT_IS_FINANCIAL_ACCOUNT", "Deactivate the financial account instead");
        if (await tx.journalLine.count({ where: { accountId: id, entry: { status: "DRAFT" } } })) throw financeError(409, "ACCOUNT_IN_DRAFTS", "Draft journals still use this account");
      }
      data.isActive = input.isActive;
    }
    if (!Object.keys(data).length) return accountDto(before);
    const after = await tx.ledgerAccount.update({ where: { id }, data });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: input.isActive === false ? "account.archive" : "account.update", entityType: "LedgerAccount", entityId: id, before, after, reason: input.reason });
    return accountDto(after);
  });
}

// ── mappings ───────────────────────────────────────────────────────────────────────────────────────────────────────

const EXPECTED_TYPE: Record<string, LedgerAccountType> = { group: "ASSET", asset: "ASSET", liability: "LIABILITY", equity: "EQUITY", revenue: "REVENUE", cogs: "COGS", expense: "EXPENSE", clearing: "ASSET", income: "OTHER_INCOME" };

export async function listMappings() {
  const { business } = await getFinanceContext();
  const mappings = await prisma.accountMapping.findMany({ where: { businessId: business.id }, include: { account: true } });
  const byKey = new Map(mappings.map((m) => [m.key, m]));
  return [...ACCOUNT_MAPPING_KEYS, ...CLEARING_MAPPING_KEYS].map((key) => {
    const m = byKey.get(key);
    return { key, account: m ? { id: m.account.id, code: m.account.code, name: m.account.name } : null };
  });
}

export async function setMapping(key: string, input: { accountId: string; reason?: string | null }, actor: FinanceActor) {
  if (!isAccountMappingKey(key)) throw financeError(404, "MAPPING_KEY_UNKNOWN", `Unknown mapping key ${key}`);
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    const account = await tx.ledgerAccount.findFirst({ where: { id: input.accountId, businessId: business.id } });
    if (!account) throw financeError(400, "ACCOUNT_NOT_FOUND", "Account not found");
    if (!account.isActive) throw financeError(400, "ACCOUNT_INACTIVE", "Archived accounts can't be mapped");
    const isGroupKey = key.startsWith("group.");
    if (isGroupKey === account.isPostable) throw financeError(400, "MAPPING_ACCOUNT_KIND", isGroupKey ? `${key} must point to a group account` : `${key} must point to an account that takes postings`);
    const expected = EXPECTED_TYPE[key.split(".")[0] ?? ""];
    if (expected && account.type !== expected) throw financeError(400, "MAPPING_TYPE_MISMATCH", `${key} needs a ${expected} account`);
    // A clearing key names a money account of the right kind (Phase 3): it is settled, carries statements and is reconciled.
    const clearing = CLEARING_ACCOUNTS.find((c) => c.key === key);
    if (clearing) {
      const fa = await tx.financialAccount.findFirst({ where: { ledgerAccountId: account.id, businessId: business.id } });
      if (!fa || fa.kind !== clearing.kind) throw financeError(400, "MAPPING_CLEARING_KIND", `${key} must point to a ${clearing.kind.toLowerCase().replace("_", " ")} financial account`);
    }
    const before = await tx.accountMapping.findUnique({ where: { businessId_key: { businessId: business.id, key } } });
    const after = before
      ? await tx.accountMapping.update({ where: { id: before.id }, data: { accountId: account.id } })
      : await tx.accountMapping.create({ data: { businessId: business.id, key, accountId: account.id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "mapping.set", entityType: "AccountMapping", entityId: after.id, before, after, reason: input.reason });
    return { key, account: { id: account.id, code: account.code, name: account.name } };
  });
}

/** The account a mapping key posts to — the only lookup posting code may use. Throws 409 when unmapped. */
export async function resolveMappedAccount(db: AppTransactionClient | typeof prisma, businessId: string, key: AccountMappingKey): Promise<LedgerAccount> {
  const mapping = await db.accountMapping.findUnique({ where: { businessId_key: { businessId, key } }, include: { account: true } });
  if (!mapping) throw financeError(409, "MAPPING_MISSING", `No account is mapped to ${key}`, { key });
  return mapping.account;
}

/** Phase 3: whether approved ESTIMATED costs may be posted for sale lines / stock with no recorded cost. Owner decision. */
export async function setCostPolicy(input: { costPolicy: "KNOWN_ONLY" | "APPROVED_ESTIMATES"; reason: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  await inTransaction(async (tx) => {
    const before = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id } });
    if (before.costPolicy === input.costPolicy) return;
    const after = await tx.financeBusiness.update({ where: { id: business.id }, data: { costPolicy: input.costPolicy } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "business.cost_policy", entityType: "FinanceBusiness", entityId: business.id, before: { costPolicy: before.costPolicy }, after: { costPolicy: after.costPolicy }, reason: input.reason });
  });
  return getBusinessSettings();
}
