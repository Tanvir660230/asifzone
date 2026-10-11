/**
 * Commerce accounting set-up (Financial Core Phase 3, docs/FINANCE_PHASE_3.md §3). Brings a business's chart up to what
 * the commerce posting rules need — the Phase 3 template accounts and their mappings, the sensitive flags, and the four
 * clearing financial accounts (COD, SSLCommerz, EPS, manual receipts) — without touching anything the owner changed:
 * an account is created only when its code is free, a mapping only when it is missing. Idempotent; every change is
 * audited in its transaction. What can't be set up safely is reported (readiness), never guessed.
 */
import { CLEARING_ACCOUNTS, COMMERCE_MAPPING_KEYS, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { createFinancialAccountInTx } from "./financial-accounts.service";
import { financeTransaction } from "./finance-tx";
import { chartState, provisionTemplateAccountsInTx } from "./chart-provisioning";

export const COMMERCE_SETUP_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:commerce-setup" };

export async function ensureCommerceAccountingInTx(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id" | "baseCurrency">, actor: FinanceActor = COMMERCE_SETUP_ACTOR) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-commerce-setup:${business.id}`}))`;
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  const needed = new Set<string>(COMMERCE_MAPPING_KEYS);
  const changes: string[] = [];

  changes.push(...(await provisionTemplateAccountsInTx(tx, business, { needed, byCode, mapped, audits, actor, reason: "Phase 3 commerce accounting set-up" })));

  for (const c of CLEARING_ACCOUNTS) {
    if (mapped.has(c.key)) continue;
    let fa = await tx.financialAccount.findUnique({ where: { businessId_name: { businessId: business.id, name: c.name } } });
    if (!fa) {
      fa = await createFinancialAccountInTx(tx, business, { kind: c.kind, name: c.name, provider: c.provider }, actor);
      changes.push(`clearing account ${c.name}`);
    }
    if (fa.kind !== c.kind || !fa.isActive) continue; // a same-named account of another kind is the owner's: left to them
    const mapping = await tx.accountMapping.create({ data: { businessId: business.id, key: c.key, accountId: fa.ledgerAccountId } });
    audits.push({ businessId: business.id, actor, action: "mapping.set", entityType: "AccountMapping", entityId: mapping.id, after: mapping, reason: "Phase 3 clearing account" });
    mapped.add(c.key);
    changes.push(`mapping ${c.key}`);
  }
  await recordFinanceAudit(tx, audits);
  return { changes, missing: COMMERCE_MAPPING_KEYS.filter((k) => !mapped.has(k)) };
}

/** Whether every account the commerce posting rules need is mapped (validated before anything posts). */
export async function commerceReadiness(db: AppTransactionClient | typeof prisma, businessId: string): Promise<{ ready: boolean; missing: AccountMappingKey[] }> {
  const mapped = new Set((await db.accountMapping.findMany({ where: { businessId }, select: { key: true } })).map((m) => m.key));
  const missing = COMMERCE_MAPPING_KEYS.filter((k) => !mapped.has(k));
  return { ready: missing.length === 0, missing };
}

export async function ensureCommerceAccounting(actor: FinanceActor = COMMERCE_SETUP_ACTOR) {
  const { business } = await getFinanceContext();
  return financeTransaction((tx) => ensureCommerceAccountingInTx(tx, business, actor));
}
