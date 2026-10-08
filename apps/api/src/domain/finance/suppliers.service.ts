/**
 * Supplier master (Financial Core Phase 4A, docs/FINANCE_PHASE_4.md §7). Installation-scoped for now (one FinanceBusiness
 * per installation); the permanent `code` is the key a future cross-installation merge uses. A supplier is never deleted
 * (database trigger) and carries NO balance: what it is owed is the AP ledger filtered by the supplier as party (4E).
 */
import type { Prisma, Supplier } from "@prisma/client";
import type { SupplierCreateInput, SupplierUpdateInput } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { getFinanceContext } from "./finance-context";
import { financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";

/** Next number of a named per-business sequence (FinanceSequence) — gap-free within committed transactions. */
export async function nextFinanceSequence(tx: AppTransactionClient, businessId: string, name: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: number }>>`
    INSERT INTO "FinanceSequence" ("businessId", "name", "next") VALUES (${businessId}, ${name}, 2)
    ON CONFLICT ("businessId", "name") DO UPDATE SET "next" = "FinanceSequence"."next" + 1
    RETURNING "next" - 1 AS n`;
  return Number(rows[0]!.n);
}

export function supplierDto(s: Supplier, currency: string) {
  return { ...s, creditLimit: s.creditLimit === null ? null : toMajorNumber(toMinor(s.creditLimit, currency), currency) };
}

async function validateDefaults(tx: AppTransactionClient, businessId: string, input: { defaultTaxCodeId?: string | null; defaultExpenseAccountId?: string | null }) {
  if (input.defaultTaxCodeId) {
    const tc = await tx.taxCode.findFirst({ where: { id: input.defaultTaxCodeId, businessId } });
    if (!tc) throw financeError(400, "TAX_CODE_NOT_FOUND", "Tax code not found");
    if (!tc.isActive) throw financeError(400, "TAX_CODE_INACTIVE", "That tax code is inactive");
  }
  if (input.defaultExpenseAccountId) {
    const a = await tx.ledgerAccount.findFirst({ where: { id: input.defaultExpenseAccountId, businessId } });
    if (!a) throw financeError(400, "ACCOUNT_NOT_FOUND", "Account not found");
    if (!a.isPostable || !a.isActive || (a.type !== "EXPENSE" && a.type !== "COGS")) {
      throw financeError(400, "SUPPLIER_EXPENSE_ACCOUNT", "A supplier's default expense account must be an active expense or cost account that takes postings");
    }
  }
}

function checkCurrency(currency: string | undefined, base: string) {
  // Phase 4H (optional) adds document currencies; until then every supplier deals in the books' currency.
  if (currency && currency !== base) throw financeError(400, "SUPPLIER_CURRENCY", `Suppliers use ${base} until foreign-currency purchasing is enabled`);
}

export async function createSupplier(input: SupplierCreateInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  checkCurrency(input.currency, business.baseCurrency);
  return financeTransaction(async (tx) => {
    await validateDefaults(tx, business.id, input);
    const code = input.code ?? `SUP-${String(await nextFinanceSequence(tx, business.id, "supplier")).padStart(4, "0")}`;
    if (await tx.supplier.findUnique({ where: { businessId_code: { businessId: business.id, code } } })) {
      throw financeError(409, "SUPPLIER_CODE_TAKEN", `Supplier code ${code} is already used`);
    }
    const created = await tx.supplier.create({
      data: {
        businessId: business.id,
        code,
        legalName: input.legalName,
        displayName: input.displayName ?? input.legalName,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email ?? null,
        address: (input.address ?? undefined) as Prisma.InputJsonValue | undefined,
        taxId: input.taxId,
        vatRegistrationNo: input.vatRegistrationNo,
        currency: input.currency ?? business.baseCurrency,
        paymentTermsDays: input.paymentTermsDays,
        paymentTermsNote: input.paymentTermsNote,
        creditLimit: input.creditLimit == null ? null : toDecimal(toMinor(input.creditLimit, business.baseCurrency), business.baseCurrency),
        defaultTaxCodeId: input.defaultTaxCodeId ?? null,
        defaultExpenseAccountId: input.defaultExpenseAccountId ?? null,
        notes: input.notes,
        evidence: input.evidence,
      },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier.create", entityType: "Supplier", entityId: created.id, after: created });
    return supplierDto(created, business.baseCurrency);
  });
}

export async function updateSupplier(id: string, input: SupplierUpdateInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  checkCurrency(input.currency, business.baseCurrency);
  return financeTransaction(async (tx) => {
    const before = await tx.supplier.findFirst({ where: { id, businessId: business.id } });
    if (!before) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    await validateDefaults(tx, business.id, input);
    const data: Prisma.SupplierUpdateInput = {};
    if (input.legalName !== undefined) data.legalName = input.legalName;
    if (input.displayName !== undefined) data.displayName = input.displayName;
    for (const k of ["contactName", "phone", "taxId", "vatRegistrationNo", "paymentTermsNote", "notes", "evidence"] as const) if (input[k] !== undefined) data[k] = input[k];
    if (input.email !== undefined) data.email = input.email ?? null;
    if (input.address !== undefined) data.address = (input.address ?? null) as Prisma.InputJsonValue;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.paymentTermsDays !== undefined) data.paymentTermsDays = input.paymentTermsDays;
    if (input.creditLimit !== undefined) data.creditLimit = input.creditLimit === null ? null : toDecimal(toMinor(input.creditLimit, business.baseCurrency), business.baseCurrency);
    if (input.defaultTaxCodeId !== undefined) data.defaultTaxCode = input.defaultTaxCodeId ? { connect: { id: input.defaultTaxCodeId } } : { disconnect: true };
    if (input.defaultExpenseAccountId !== undefined) data.defaultExpenseAccount = input.defaultExpenseAccountId ? { connect: { id: input.defaultExpenseAccountId } } : { disconnect: true };
    const after = await tx.supplier.update({ where: { id }, data });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier.update", entityType: "Supplier", entityId: id, before, after });
    return supplierDto(after, business.baseCurrency);
  });
}

/** ACTIVE / ON_HOLD / INACTIVE — never deleted. Holding or deactivating needs a reason (kept on the supplier and audited). */
export async function setSupplierStatus(id: string, input: { status: Supplier["status"]; reason: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await tx.supplier.findFirst({ where: { id, businessId: business.id } });
    if (!before) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    if (before.status === input.status) return supplierDto(before, business.baseCurrency);
    const after = await tx.supplier.update({ where: { id }, data: { status: input.status, statusReason: input.status === "ACTIVE" ? null : input.reason } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier.status", entityType: "Supplier", entityId: id, before: { status: before.status }, after: { status: after.status }, reason: input.reason });
    return supplierDto(after, business.baseCurrency);
  });
}

export async function getSupplier(id: string) {
  const { business } = await getFinanceContext();
  const s = await prisma.supplier.findFirst({ where: { id, businessId: business.id }, include: { defaultTaxCode: true, defaultExpenseAccount: { select: { id: true, code: true, name: true } } } });
  if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
  return { ...supplierDto(s, business.baseCurrency), defaultTaxCode: s.defaultTaxCode, defaultExpenseAccount: s.defaultExpenseAccount };
}

export async function listSuppliers(q: { q?: string; status?: Supplier["status"]; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.SupplierWhereInput = {
    businessId: business.id,
    status: q.status,
    ...(q.q ? { OR: [{ code: { contains: q.q, mode: "insensitive" } }, { displayName: { contains: q.q, mode: "insensitive" } }, { legalName: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({ where, orderBy: [{ status: "asc" }, { displayName: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, suppliers: rows.map((s) => supplierDto(s, business.baseCurrency)) };
}
