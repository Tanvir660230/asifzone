/**
 * Purchasing accounting set-up (Financial Core Phase 4A, docs/FINANCE_PHASE_4.md §3, §14): brings an existing business's
 * chart up to what purchasing, AP and inventory costing post to — 2115 GRNI (+ supplier returns), 1710 input VAT, 5150
 * inventory cost adjustments (+ purchase price differences), 5210 count adjustments, 6650 freight-in, 6960 non-recoverable
 * tax, 6900 other purchase expenses, 7200 purchase discounts — without touching anything the owner changed. Idempotent;
 * audited. What can't be set up safely is reported (readiness), never guessed.
 */
import { PURCHASING_MAPPING_KEYS, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { chartState, provisionTemplateAccountsInTx } from "./chart-provisioning";

export const PURCHASING_SETUP_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:purchasing-setup" };

export async function ensurePurchasingAccountingInTx(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id">, actor: FinanceActor = PURCHASING_SETUP_ACTOR) {
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  const changes = await provisionTemplateAccountsInTx(tx, business, { needed: new Set<string>(PURCHASING_MAPPING_KEYS), byCode, mapped, audits, actor, reason: "Phase 4 purchasing accounting set-up" });
  await recordFinanceAudit(tx, audits);
  return { changes, missing: PURCHASING_MAPPING_KEYS.filter((k) => !mapped.has(k)) };
}

export async function ensurePurchasingAccounting(actor: FinanceActor = PURCHASING_SETUP_ACTOR) {
  const { business } = await getFinanceContext();
  return financeTransaction((tx) => ensurePurchasingAccountingInTx(tx, business, actor));
}

/** Whether every account purchasing and costing post to is mapped (checked before anything posts). */
export async function purchasingReadiness(db: AppTransactionClient | typeof prisma, businessId: string): Promise<{ ready: boolean; missing: AccountMappingKey[] }> {
  const mapped = new Set((await db.accountMapping.findMany({ where: { businessId }, select: { key: true } })).map((m) => m.key));
  const missing = PURCHASING_MAPPING_KEYS.filter((k) => !mapped.has(k));
  return { ready: missing.length === 0, missing };
}

export async function purchasingStatus() {
  const { business } = await getFinanceContext();
  return { readiness: await purchasingReadiness(prisma, business.id), currency: business.baseCurrency };
}
