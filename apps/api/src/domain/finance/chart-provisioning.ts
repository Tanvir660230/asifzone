/**
 * Bringing an existing business's chart up to what a posting area needs (Phase 3 commerce, Phase 4 purchasing — docs/
 * FINANCE_PHASE_4.md §3): the template accounts behind the needed mapping keys and those mappings, without touching
 * anything the owner changed. An account is created only when its code is free and its key unmapped; a mapping only when
 * it is missing and the account is of the template's type. Every change is audited by the caller's transaction.
 */
import type { LedgerAccount } from "@prisma/client";
import { DEFAULT_CHART_OF_ACCOUNTS, defaultNormalBalance, templateMappings } from "@clothing-brand/shared";
import type { AppTransactionClient } from "../../config/prisma";
import type { FinanceActor, FinanceAuditInput } from "./finance-audit";
import type { FinanceBusinessInfo } from "./finance-context";

export async function chartState(tx: AppTransactionClient, businessId: string) {
  // One lock for every chart provisioning of a business — two set-ups never create the same account twice.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-chart-provisioning:${businessId}`}))`;
  const byCode = new Map<string, LedgerAccount>((await tx.ledgerAccount.findMany({ where: { businessId } })).map((a) => [a.code, a]));
  const mapped = new Set((await tx.accountMapping.findMany({ where: { businessId }, select: { key: true } })).map((m) => m.key));
  return { byCode, mapped };
}

export async function provisionTemplateAccountsInTx(
  tx: AppTransactionClient,
  business: Pick<FinanceBusinessInfo, "id">,
  opts: { needed: Set<string>; byCode: Map<string, LedgerAccount>; mapped: Set<string>; audits: FinanceAuditInput[]; actor: FinanceActor; reason: string },
): Promise<string[]> {
  const { needed, byCode, mapped, audits, actor, reason } = opts;
  const changes: string[] = [];
  for (const t of DEFAULT_CHART_OF_ACCOUNTS) {
    const keys = templateMappings(t).filter((k) => needed.has(k) && !mapped.has(k));
    let account = byCode.get(t.code);
    if (!account && keys.length) {
      const parent = t.parent ? byCode.get(t.parent) : undefined;
      if (t.parent && (!parent || parent.isPostable || parent.type !== t.type)) continue;
      account = await tx.ledgerAccount.create({
        data: {
          businessId: business.id, code: t.code, name: t.name, type: t.type, normalBalance: t.normalBalance ?? defaultNormalBalance(t.type),
          parentId: parent?.id ?? null, isPostable: !t.group, isSystem: true, isSensitive: t.sensitive ?? false,
        },
      });
      byCode.set(t.code, account);
      audits.push({ businessId: business.id, actor, action: "account.create", entityType: "LedgerAccount", entityId: account.id, after: account, reason });
      changes.push(`account ${t.code}`);
    }
    // Sensitive flags apply to the template's own (system) accounts only; an account the owner created keeps its setting.
    if (account && t.sensitive && account.isSystem && !account.isSensitive && account.type === t.type) {
      const after = await tx.ledgerAccount.update({ where: { id: account.id }, data: { isSensitive: true } });
      audits.push({ businessId: business.id, actor, action: "account.mark_sensitive", entityType: "LedgerAccount", entityId: account.id, before: { isSensitive: false }, after: { isSensitive: true } });
      byCode.set(t.code, after);
      account = after;
      changes.push(`sensitive ${t.code}`);
    }
    if (!account || account.type !== t.type || account.isPostable !== !t.group || !account.isActive) continue;
    for (const key of keys) {
      const mapping = await tx.accountMapping.create({ data: { businessId: business.id, key, accountId: account.id } });
      audits.push({ businessId: business.id, actor, action: "mapping.set", entityType: "AccountMapping", entityId: mapping.id, after: mapping, reason });
      mapped.add(key);
      changes.push(`mapping ${key}`);
    }
  }
  return changes;
}
