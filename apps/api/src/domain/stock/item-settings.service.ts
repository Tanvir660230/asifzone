/**
 * Per-item stock settings (docs/STOCK_HUB.md §7): the usual supplier, the days an order takes to arrive and the days of
 * stock a reorder should cover. An item without a row has the defaults, so nothing needs setting up before the reorder
 * suggestion works. Also the last price paid per item (the newest posted goods receipt line, reversed receipts ignored),
 * which the purchase form shows next to what is typed.
 */
import { STOCK_ITEM_DEFAULTS, stockItemSettingsSchema, type StockItemSettings, type StockItemSettingsInput } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordAudit } from "../../lib/audit";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { businessDateOf, financeError } from "../finance/finance-values";

export type ItemSettings = StockItemSettings;

const DEFAULTS: ItemSettings = { ...STOCK_ITEM_DEFAULTS };

export async function getItemSettings(variantIds: string[]): Promise<Map<string, ItemSettings>> {
  const rows = await prisma.stockItemSetting.findMany({ where: { variantId: { in: variantIds } }, select: { variantId: true, preferredSupplierId: true, leadTimeDays: true, coverDays: true } });
  const byId = new Map(rows.map((r) => [r.variantId, { preferredSupplierId: r.preferredSupplierId, leadTimeDays: r.leadTimeDays, coverDays: r.coverDays }]));
  return new Map(variantIds.map((id) => [id, byId.get(id) ?? DEFAULTS]));
}

export async function setItemSettings(variantId: string, raw: StockItemSettingsInput, actor: FinanceActor): Promise<ItemSettings> {
  const parsed = stockItemSettingsSchema.safeParse(raw);
  if (!parsed.success) throw financeError(400, "STOCK_SETTINGS_INVALID", parsed.error.issues[0]?.message ?? "Check the settings");
  const input = parsed.data;
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, sku: true, product: { select: { trackInventory: true, deletedAt: true } } } });
  if (!variant || variant.product.deletedAt) throw financeError(404, "VARIANT_NOT_FOUND", "Item not found");
  if (!variant.product.trackInventory) throw financeError(400, "COUNT_UNTRACKED", `${variant.sku} isn't stock-tracked`);
  if (input.preferredSupplierId) {
    const { business } = await getFinanceContext();
    const supplier = await prisma.supplier.findFirst({ where: { id: input.preferredSupplierId, businessId: business.id }, select: { id: true } });
    if (!supplier) throw financeError(400, "SUPPLIER_NOT_FOUND", "Supplier not found");
  }
  const before = (await getItemSettings([variantId])).get(variantId)!;
  const adminId = actor.type === "ADMIN" ? actor.adminId : null;
  const data = { ...input, updatedByAdminId: adminId };
  await prisma.stockItemSetting.upsert({ where: { variantId }, create: { variantId, ...data }, update: data });
  recordAudit({ adminId, action: "stock.item_settings_changed", entityType: "product_variants", entityId: variantId, ipAddress: null, metadata: { sku: variant.sku, before, after: input } });
  return input;
}

export interface LastPrice {
  unitCost: number;
  supplierId: string;
  date: string;
}

/** The newest posted (not reversed) goods receipt line per item: its unit cost, supplier and receipt date. */
export async function lastPurchasePrice(variantIds: string[]): Promise<Map<string, LastPrice>> {
  if (!variantIds.length) return new Map();
  const lines = await prisma.goodsReceiptLine.findMany({
    where: { variantId: { in: variantIds }, qtyAccepted: { gt: 0 }, goodsReceipt: { status: "POSTED" } },
    select: { variantId: true, unitCost: true, goodsReceipt: { select: { supplierId: true, receiptDate: true } } },
    orderBy: [{ goodsReceipt: { receiptDate: "desc" } }, { goodsReceipt: { postedAt: "desc" } }, { lineNo: "asc" }],
    distinct: ["variantId"],
  });
  return new Map(lines.map((l) => [l.variantId, { unitCost: Number(l.unitCost), supplierId: l.goodsReceipt.supplierId, date: businessDateOf(l.goodsReceipt.receiptDate) }]));
}
