/**
 * Purchase tax codes (Financial Core Phase 4A, docs/FINANCE_PHASE_4.md §19). Configurable, no jurisdiction rules: a code is
 * a rate, a recoverable share and the mapping keys the two parts post to. Rate, share and keys are permanent (database
 * trigger) — a new rate is a new code, so a posted document's tax can always be explained by the code it names.
 */
import type { TaxCode } from "@prisma/client";
import { isAccountMappingKey, type TaxCodeCreateInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { financeError } from "./finance-values";
import { financeTransaction } from "./finance-tx";

export function taxCodeDto(t: TaxCode) {
  return { ...t, rate: t.rate.toString(), recoverablePct: t.recoverablePct.toString() };
}

/** Recoverable tax is an asset (input VAT); the non-recoverable part of an expense line is an expense. */
async function checkKey(businessId: string, key: string, type: "ASSET" | "EXPENSE", what: string) {
  if (!isAccountMappingKey(key)) throw financeError(400, "MAPPING_KEY_UNKNOWN", `Unknown mapping key ${key}`);
  const m = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId, key } }, include: { account: true } });
  if (m && m.account.type !== type) throw financeError(400, "TAX_CODE_ACCOUNT_TYPE", `${what} must post to an ${type.toLowerCase()} account (${key} points to ${m.account.code})`);
}

export async function createTaxCode(input: TaxCodeCreateInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const recoverableMappingKey = input.recoverableMappingKey ?? "asset.vat_input";
  const nonRecoverableMappingKey = input.nonRecoverableMappingKey ?? "expense.non_recoverable_tax";
  await checkKey(business.id, recoverableMappingKey, "ASSET", "Recoverable tax");
  await checkKey(business.id, nonRecoverableMappingKey, "EXPENSE", "Non-recoverable tax");
  return financeTransaction(async (tx) => {
    if (await tx.taxCode.findUnique({ where: { businessId_code: { businessId: business.id, code: input.code } } })) {
      throw financeError(409, "TAX_CODE_TAKEN", `Tax code ${input.code} already exists — a new rate needs a new code`);
    }
    const created = await tx.taxCode.create({
      data: { businessId: business.id, code: input.code, name: input.name, description: input.description, rate: input.rate, recoverablePct: input.recoverablePct, recoverableMappingKey, nonRecoverableMappingKey },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "tax_code.create", entityType: "TaxCode", entityId: created.id, after: created });
    return taxCodeDto(created);
  });
}

export async function updateTaxCode(id: string, input: { name?: string; description?: string | null; isActive?: boolean }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await tx.taxCode.findFirst({ where: { id, businessId: business.id } });
    if (!before) throw financeError(404, "TAX_CODE_NOT_FOUND", "Tax code not found");
    const after = await tx.taxCode.update({ where: { id }, data: { name: input.name, description: input.description, isActive: input.isActive } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "tax_code.update", entityType: "TaxCode", entityId: id, before, after });
    return taxCodeDto(after);
  });
}

export async function listTaxCodes(opts: { activeOnly?: boolean } = {}) {
  const { business } = await getFinanceContext();
  const rows = await prisma.taxCode.findMany({ where: { businessId: business.id, ...(opts.activeOnly ? { isActive: true } : {}) }, orderBy: [{ isActive: "desc" }, { code: "asc" }] });
  return { taxCodes: rows.map(taxCodeDto) };
}
