/**
 * Financial accounts (Phase 1): where money is held — cash, bank, bKash/Nagad, gateway and courier clearing. Each one owns
 * a ledger account created under its kind's group (mapping `group.*`); its balance is that account's ledger balance.
 */
import type { FinancialAccount, FinancialAccountKind, LedgerAccount } from "@prisma/client";
import type { AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { financeTransaction } from "./finance-tx";
import { getFinanceContext } from "./finance-context";
import { resolveMappedAccount } from "./chart.service";
import { accountSums } from "./ledger.service";
import { financeError, toMajorNumber, toMinor } from "./finance-values";

export const GROUP_FOR_KIND: Record<FinancialAccountKind, AccountMappingKey> = {
  CASH: "group.cash",
  BANK: "group.bank",
  MOBILE_WALLET: "group.mobile_wallet",
  PAYMENT_GATEWAY: "group.payment_gateway",
  COURIER: "group.courier",
  OTHER: "group.other_money",
};

const inTransaction = financeTransaction;

function dto(f: FinancialAccount & { ledgerAccount: LedgerAccount }, balanceMinor: number, currency: string) {
  return {
    id: f.id, kind: f.kind, name: f.name, provider: f.provider, accountNumberLast4: f.accountNumberLast4, currency: f.currency,
    brandId: f.brandId, isActive: f.isActive,
    ledgerAccount: { id: f.ledgerAccount.id, code: f.ledgerAccount.code, name: f.ledgerAccount.name },
    balance: toMajorNumber(balanceMinor, currency),
  };
}

export async function listFinancialAccounts() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const [rows, sums] = await Promise.all([
    prisma.financialAccount.findMany({ where: { businessId: business.id }, include: { ledgerAccount: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    accountSums(business.id, {}),
  ]);
  const byAccount = new Map(sums.map((s) => [s.accountId, toMinor(s.periodDebit, cur) - toMinor(s.periodCredit, cur)]));
  return rows.map((r) => dto(r, byAccount.get(r.ledgerAccountId) ?? 0, cur));
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

export async function createFinancialAccount(input: { kind: FinancialAccountKind; name: string; provider?: string | null; accountNumberLast4?: string | null; brandId?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return inTransaction(async (tx) => {
    if (await tx.financialAccount.findUnique({ where: { businessId_name: { businessId: business.id, name: input.name } } })) {
      throw financeError(409, "FINANCIAL_ACCOUNT_NAME_TAKEN", `A financial account named "${input.name}" already exists`);
    }
    if (input.brandId && !(await tx.financeBrand.findFirst({ where: { id: input.brandId, businessId: business.id } }))) {
      throw financeError(400, "BRAND_NOT_FOUND", "Brand not found in this business");
    }
    const group = await resolveMappedAccount(tx, business.id, GROUP_FOR_KIND[input.kind]);
    const ledgerAccount = await tx.ledgerAccount.create({
      data: { businessId: business.id, code: await nextChildCode(tx, business.id, group), name: input.name, type: group.type, normalBalance: "DEBIT", parentId: group.id, isPostable: true, isSystem: true },
    });
    const account = await tx.financialAccount.create({
      data: { businessId: business.id, brandId: input.brandId ?? null, kind: input.kind, name: input.name, provider: input.provider ?? null, accountNumberLast4: input.accountNumberLast4 ?? null, currency: business.baseCurrency, ledgerAccountId: ledgerAccount.id },
      include: { ledgerAccount: true },
    });
    await recordFinanceAudit(tx, [
      { businessId: business.id, actor, action: "account.create", entityType: "LedgerAccount", entityId: ledgerAccount.id, after: ledgerAccount, sourceType: "FinancialAccount", sourceRef: account.id },
      { businessId: business.id, actor, action: "financial_account.create", entityType: "FinancialAccount", entityId: account.id, after: account },
    ]);
    return dto(account, 0, business.baseCurrency);
  });
}

export async function updateFinancialAccount(id: string, input: { name?: string; provider?: string | null; accountNumberLast4?: string | null; isActive?: boolean; reason?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return inTransaction(async (tx) => {
    const before = await tx.financialAccount.findFirst({ where: { id, businessId: business.id }, include: { ledgerAccount: true } });
    if (!before) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Financial account not found");
    const sums = (await accountSums(business.id, {})).find((s) => s.accountId === before.ledgerAccountId);
    const balance = sums ? toMinor(sums.periodDebit, cur) - toMinor(sums.periodCredit, cur) : 0;
    if (input.isActive === false && before.isActive && balance !== 0) {
      throw financeError(409, "FINANCIAL_ACCOUNT_HAS_BALANCE", "Transfer the balance out before deactivating this account", { balance: toMajorNumber(balance, cur) });
    }
    if (input.name && input.name !== before.name && (await tx.financialAccount.findUnique({ where: { businessId_name: { businessId: business.id, name: input.name } } }))) {
      throw financeError(409, "FINANCIAL_ACCOUNT_NAME_TAKEN", `A financial account named "${input.name}" already exists`);
    }
    const after = await tx.financialAccount.update({
      where: { id },
      data: { name: input.name, provider: input.provider, accountNumberLast4: input.accountNumberLast4, isActive: input.isActive },
      include: { ledgerAccount: true },
    });
    const ledgerChanges = { name: input.name !== undefined && input.name !== before.ledgerAccount.name ? input.name : undefined, isActive: input.isActive !== undefined && input.isActive !== before.ledgerAccount.isActive ? input.isActive : undefined };
    const audit = [{ businessId: business.id, actor, action: "financial_account.update", entityType: "FinancialAccount", entityId: id, before, after, reason: input.reason }];
    if (ledgerChanges.name !== undefined || ledgerChanges.isActive !== undefined) {
      const ledgerAfter = await tx.ledgerAccount.update({ where: { id: before.ledgerAccountId }, data: ledgerChanges });
      audit.push({ businessId: business.id, actor, action: "account.update", entityType: "LedgerAccount", entityId: before.ledgerAccountId, before: before.ledgerAccount as never, after: ledgerAfter as never, reason: input.reason });
    }
    await recordFinanceAudit(tx, audit);
    return dto({ ...after, ledgerAccount: { ...after.ledgerAccount, ...Object.fromEntries(Object.entries(ledgerChanges).filter(([, v]) => v !== undefined)) } }, balance, cur);
  });
}
