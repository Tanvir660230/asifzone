/**
 * Owner's books set-up (docs/FINANCE_OWNER_BOOKS.md §13): brings a business's chart up to what the owner's-books features
 * post to — cash over/short, the courier and gateway charges accrued until a payout replaces them, ad-platform balances,
 * prepaid costs, packaging used, courier claims and landed costs to allocate — without touching anything the owner
 * changed (chart-provisioning: an account only when its code is free, a mapping only when it is missing). Idempotent.
 */
import { OWNER_BOOKS_MAPPING_KEYS, type AccountMappingKey } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import type { FinanceBusinessInfo } from "./finance-context";
import { chartState, provisionTemplateAccountsInTx } from "./chart-provisioning";
import { financeError } from "./finance-values";

export const OWNER_BOOKS_SETUP_ACTOR: FinanceActor = { type: "SYSTEM", label: "system:owner-books-setup" };

export async function ensureOwnerBooksSetupInTx(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id">, actor: FinanceActor = OWNER_BOOKS_SETUP_ACTOR) {
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  if (OWNER_BOOKS_MAPPING_KEYS.every((k) => mapped.has(k))) return { changes: [] as string[], missing: [] as AccountMappingKey[] };
  const changes = await provisionTemplateAccountsInTx(tx, business, { needed: new Set<string>(OWNER_BOOKS_MAPPING_KEYS), byCode, mapped, audits, actor, reason: "Owner's books set-up" });
  await recordFinanceAudit(tx, audits);
  return { changes, missing: OWNER_BOOKS_MAPPING_KEYS.filter((k) => !mapped.has(k)) };
}

/** Refuses (409) when a key a feature posts to can't be mapped — the owner changed the chart in a way set-up won't guess. */
export async function requireOwnerBooksKeys(tx: AppTransactionClient | typeof prisma, businessId: string, keys: readonly AccountMappingKey[]) {
  const mapped = new Set((await tx.accountMapping.findMany({ where: { businessId, key: { in: [...keys] } }, select: { key: true } })).map((m) => m.key));
  const missing = keys.filter((k) => !mapped.has(k));
  if (missing.length) throw financeError(409, "MAPPINGS_MISSING", `Map these accounts in Finance → Setup → Account mapping first: ${missing.join(", ")}`, { missing });
}
