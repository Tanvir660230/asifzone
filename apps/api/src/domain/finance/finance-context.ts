/**
 * Which business's books this installation keeps, and which brand it is within that business (docs/FINANCE_PHASE_1.md §2).
 *
 * F0-1: one business, several brands, each brand's commerce in its own installation and database. This installation is
 * the business's finance home (FINANCE_BUSINESS_KEY, default "main"); its own brand is the FinanceBrand whose installId is
 * this process's INSTALL_ID. A later phase lets other installations send events here; nothing here assumes there is only
 * one brand.
 *
 * The business is bootstrapped once, on first use: the business row (currency and timezone from the commerce settings),
 * this installation's brand, the default chart of accounts and its mappings — each with its audit entry, in one
 * transaction, serialised by an advisory lock so two first requests can't both create it.
 */
import { DEFAULT_CHART_OF_ACCOUNTS, businessDate, defaultNormalBalance, templateMappings } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { getCommerceSettings } from "../config/commerce-settings";
import { getSettings } from "../../modules/settings/settings.service";
import { recordFinanceAudit, SYSTEM_BOOTSTRAP, type FinanceAuditInput } from "./finance-audit";
import { businessDateOf } from "./finance-values";
import { financeTransaction } from "./finance-tx";

export interface FinanceBusinessInfo {
  id: string;
  key: string;
  name: string;
  baseCurrency: string;
  timezone: string;
  fiscalYearStartMonth: number;
  /** The Financial Opening Date, or null until configured. */
  openingDate: string | null;
}

export interface FinanceContext {
  business: FinanceBusinessInfo;
  /** This installation's brand. */
  brand: { id: string; key: string; name: string };
}

export const FINANCE_BUSINESS_KEY = (process.env.FINANCE_BUSINESS_KEY ?? "").trim() || "main";

function toInfo(b: { id: string; key: string; name: string; baseCurrency: string; timezone: string; fiscalYearStartMonth: number; openingDate: Date | null }): FinanceBusinessInfo {
  return { id: b.id, key: b.key, name: b.name, baseCurrency: b.baseCurrency, timezone: b.timezone, fiscalYearStartMonth: b.fiscalYearStartMonth, openingDate: b.openingDate ? businessDateOf(b.openingDate) : null };
}

async function load(db: AppTransactionClient | typeof prisma, businessKey: string): Promise<FinanceContext | null> {
  const business = await db.financeBusiness.findUnique({ where: { key: businessKey } });
  if (!business) return null;
  const brand = await db.financeBrand.findUnique({ where: { businessId_installId: { businessId: business.id, installId } } });
  if (!brand) return null;
  return { business: toInfo(business), brand: { id: brand.id, key: brand.key, name: brand.name } };
}

/** The finance context of this installation, bootstrapping the business on first use. */
export async function getFinanceContext(businessKey: string = FINANCE_BUSINESS_KEY): Promise<FinanceContext> {
  const existing = await load(prisma, businessKey);
  if (existing) return existing;
  const [{ currency, timezone }, settings] = await Promise.all([getCommerceSettings(), getSettings()]);
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-bootstrap:${businessKey}`}))`;
    const again = await load(tx, businessKey);
    if (again) return again;

    const audit: FinanceAuditInput[] = [];
    let business = await tx.financeBusiness.findUnique({ where: { key: businessKey } });
    if (!business) {
      business = await tx.financeBusiness.create({
        data: { key: businessKey, name: settings.storeName || "Business", baseCurrency: currency, timezone, fiscalYearStartMonth: 7 },
      });
      audit.push({ businessId: business.id, actor: SYSTEM_BOOTSTRAP, action: "business.create", entityType: "FinanceBusiness", entityId: business.id, after: business });
      const idByCode = new Map<string, string>();
      for (const t of DEFAULT_CHART_OF_ACCOUNTS) {
        const account = await tx.ledgerAccount.create({
          data: {
            businessId: business.id,
            code: t.code,
            name: t.name,
            type: t.type,
            normalBalance: t.normalBalance ?? defaultNormalBalance(t.type),
            parentId: t.parent ? idByCode.get(t.parent) : null,
            isPostable: !t.group,
            isSystem: true,
            isSensitive: t.sensitive ?? false,
          },
        });
        idByCode.set(t.code, account.id);
        audit.push({ businessId: business.id, actor: SYSTEM_BOOTSTRAP, action: "account.create", entityType: "LedgerAccount", entityId: account.id, after: account });
        for (const key of templateMappings(t)) {
          const mapping = await tx.accountMapping.create({ data: { businessId: business.id, key, accountId: account.id } });
          audit.push({ businessId: business.id, actor: SYSTEM_BOOTSTRAP, action: "mapping.set", entityType: "AccountMapping", entityId: mapping.id, after: mapping });
        }
      }
    }
    const brandKey = installId;
    const brand = await tx.financeBrand.create({ data: { businessId: business.id, key: brandKey, name: settings.storeName || brandKey, installId } });
    audit.push({ businessId: business.id, actor: SYSTEM_BOOTSTRAP, action: "brand.create", entityType: "FinanceBrand", entityId: brand.id, after: brand });
    await recordFinanceAudit(tx, audit);
    return { business: toInfo(business), brand: { id: brand.id, key: brand.key, name: brand.name } };
  });
}

/** Today's business date in the business timezone. */
export function businessToday(business: Pick<FinanceBusinessInfo, "timezone">, now: Date = new Date()): string {
  return businessDate(now, business.timezone);
}
