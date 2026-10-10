import { Router, type NextFunction, type Request, type Response } from "express";
import {
  goodsReceiptCreateSchema,
  goodsReceiptListQuerySchema,
  goodsReceiptPostSchema,
  purchaseOrderCreateSchema,
  purchaseOrderListQuerySchema,
  purchaseOrderReasonSchema,
  purchaseOrderUpdateSchema,
  purchaseReturnCreateSchema,
  purchaseReturnListQuerySchema,
  purchasingReportQuerySchema,
  purchasingSettingsSchema,
  supplierAccountQuerySchema,
  supplierAllocationCreateSchema,
  supplierAllocationReleaseSchema,
  supplierRefundSchema,
  supplierCreateSchema,
  supplierPaymentCreateSchema,
  supplierInvoiceCreateSchema,
  supplierInvoiceListQuerySchema,
  supplierInvoicePostSchema,
  supplierInvoiceUpdateSchema,
  supplierInvoiceVoidSchema,
  supplierOpenItemsQuerySchema,
  supplierListQuerySchema,
  supplierStatusSchema,
  supplierUpdateSchema,
  taxCodeCreateSchema,
  taxCodeUpdateSchema,
} from "@clothing-brand/shared";
import { z } from "zod";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { actorOf } from "../finance/finance.routes";
import * as suppliers from "../../domain/finance/suppliers.service";
import * as taxCodes from "../../domain/finance/tax-codes.service";
import { ensurePurchasingAccounting, purchasingStatus, updatePurchasingSettings } from "../../domain/finance/purchasing-setup.service";
import * as orders from "../../domain/finance/purchase-orders.service";
import * as receipts from "../../domain/finance/goods-receipts.service";
import * as returns from "../../domain/finance/purchase-returns.service";
import * as invoices from "../../domain/finance/supplier-invoices.service";
import * as payments from "../../domain/finance/supplier-payments.service";
import * as reports from "../../domain/finance/purchasing-reports.service";
import { idempotencyKeyOf } from "../orders/order.controller";

/**
 * Purchasing, suppliers / AP and inventory costing (Financial Core Phase 4, docs/FINANCE_PHASE_4.md §23). 4A: set-up,
 * suppliers and purchase tax codes. STAFF runs suppliers and (from 4D) purchasing; configuration stays OWNER-only.
 * Every change is recorded in the financial audit trail by the service, so the generic admin audit is skipped.
 */
export const purchasingRouter = Router();

purchasingRouter.use(requireAdmin);
purchasingRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals.auditHandled = true;
  next();
});

const id = (req: Request) => req.params.id!;

purchasingRouter.get("/status", requirePermission("purchasing.read"), asyncHandler(async (_req, res) => res.json(await purchasingStatus())));
purchasingRouter.post("/setup", requirePermission("finance.configure"), asyncHandler(async (req, res) => res.json(await ensurePurchasingAccounting(await actorOf(req)))));

purchasingRouter.get("/suppliers", requirePermission("suppliers.read"), validate(supplierListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await suppliers.listSuppliers(req.query as never))));
purchasingRouter.get("/suppliers/:id", requirePermission("suppliers.read"), asyncHandler(async (req, res) => res.json(await suppliers.getSupplier(id(req)))));
purchasingRouter.post("/suppliers", requirePermission("suppliers.manage"), validate(supplierCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await suppliers.createSupplier(req.body, await actorOf(req)))));
purchasingRouter.patch("/suppliers/:id", requirePermission("suppliers.manage"), validate(supplierUpdateSchema), asyncHandler(async (req, res) => res.json(await suppliers.updateSupplier(id(req), req.body, await actorOf(req)))));
purchasingRouter.post("/suppliers/:id/status", requirePermission("suppliers.manage"), validate(supplierStatusSchema), asyncHandler(async (req, res) => res.json(await suppliers.setSupplierStatus(id(req), req.body, await actorOf(req)))));

purchasingRouter.get("/tax-codes", requirePermission("purchasing.read"), validate(z.object({ activeOnly: z.enum(["true", "false"]).optional() }), "query"), asyncHandler(async (req, res) => res.json(await taxCodes.listTaxCodes({ activeOnly: req.query.activeOnly === "true" }))));
purchasingRouter.post("/tax-codes", requirePermission("finance.configure"), validate(taxCodeCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await taxCodes.createTaxCode(req.body, await actorOf(req)))));
purchasingRouter.patch("/tax-codes/:id", requirePermission("finance.configure"), validate(taxCodeUpdateSchema), asyncHandler(async (req, res) => res.json(await taxCodes.updateTaxCode(id(req), req.body, await actorOf(req)))));
purchasingRouter.patch("/settings", requirePermission("finance.configure"), validate(purchasingSettingsSchema), asyncHandler(async (req, res) => res.json(await updatePurchasingSettings(req.body, await actorOf(req)))));

// ── Phase 4D: purchase orders, goods receipts, supplier returns (docs/FINANCE_PHASE_4D.md) ─────────────────────────────
purchasingRouter.get("/variants", requirePermission("purchasing.read"), validate(z.object({ q: z.string().trim().max(100).optional(), take: z.coerce.number().int().min(1).max(50).default(20) }), "query"), asyncHandler(async (req, res) => res.json(await orders.searchPurchasableVariants(req.query as never))));
const reason = (req: Request) => (req.body as { reason: string }).reason;

purchasingRouter.get("/purchase-orders", requirePermission("purchasing.read"), validate(purchaseOrderListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await orders.listPurchaseOrders(req.query as never))));
purchasingRouter.get("/purchase-orders/:id", requirePermission("purchasing.read"), asyncHandler(async (req, res) => res.json(await orders.getPurchaseOrder(id(req)))));
purchasingRouter.post("/purchase-orders", requirePermission("purchasing.manage"), validate(purchaseOrderCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await orders.createPurchaseOrder(req.body, await actorOf(req)))));
purchasingRouter.patch("/purchase-orders/:id", requirePermission("purchasing.manage"), validate(purchaseOrderUpdateSchema), asyncHandler(async (req, res) => res.json(await orders.updatePurchaseOrder(id(req), req.body, await actorOf(req)))));
purchasingRouter.delete("/purchase-orders/:id", requirePermission("purchasing.manage"), asyncHandler(async (req, res) => {
  await orders.deleteDraftPurchaseOrder(id(req), await actorOf(req));
  res.status(204).end();
}));
purchasingRouter.post("/purchase-orders/:id/submit", requirePermission("purchasing.manage"), asyncHandler(async (req, res) => res.json(await orders.submitPurchaseOrder(id(req), await actorOf(req)))));
purchasingRouter.post("/purchase-orders/:id/return-to-draft", requirePermission("purchasing.manage"), asyncHandler(async (req, res) => res.json(await orders.returnPurchaseOrderToDraft(id(req), await actorOf(req)))));
purchasingRouter.post("/purchase-orders/:id/cancel", requirePermission("purchasing.manage"), validate(purchaseOrderReasonSchema), asyncHandler(async (req, res) => res.json(await orders.cancelPurchaseOrder(id(req), reason(req), await actorOf(req)))));
purchasingRouter.post("/purchase-orders/:id/approve", requirePermission("purchasing.approve"), asyncHandler(async (req, res) => res.json(await orders.approvePurchaseOrder(id(req), await actorOf(req)))));
purchasingRouter.post("/purchase-orders/:id/close", requirePermission("purchasing.approve"), validate(purchaseOrderReasonSchema), asyncHandler(async (req, res) => res.json(await orders.closePurchaseOrder(id(req), reason(req), await actorOf(req)))));

purchasingRouter.get("/goods-receipts", requirePermission("purchasing.read"), validate(goodsReceiptListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await receipts.listGoodsReceipts(req.query as never))));
purchasingRouter.get("/goods-receipts/:id", requirePermission("purchasing.read"), asyncHandler(async (req, res) => res.json(await receipts.getGoodsReceipt(id(req)))));
purchasingRouter.post("/goods-receipts", requirePermission("purchasing.receive"), validate(goodsReceiptCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await receipts.createGoodsReceipt(req.body, await actorOf(req)))));
purchasingRouter.delete("/goods-receipts/:id", requirePermission("purchasing.receive"), asyncHandler(async (req, res) => {
  await receipts.deleteDraftGoodsReceipt(id(req), await actorOf(req));
  res.status(204).end();
}));
purchasingRouter.post("/goods-receipts/:id/post", requirePermission("purchasing.receive"), validate(goodsReceiptPostSchema), asyncHandler(async (req, res) => res.json(await receipts.postGoodsReceipt(id(req), req.body, await actorOf(req)))));
purchasingRouter.post("/goods-receipts/:id/reverse", requirePermission("purchasing.approve"), validate(purchaseOrderReasonSchema), asyncHandler(async (req, res) => res.json(await receipts.reverseGoodsReceipt(id(req), reason(req), await actorOf(req)))));

purchasingRouter.get("/returns", requirePermission("purchasing.read"), validate(purchaseReturnListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await returns.listPurchaseReturns(req.query as never))));
purchasingRouter.get("/returns/:id", requirePermission("purchasing.read"), asyncHandler(async (req, res) => res.json(await returns.getPurchaseReturn(id(req)))));
purchasingRouter.post("/returns", requirePermission("purchasing.manage"), validate(purchaseReturnCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await returns.createPurchaseReturn(req.body, await actorOf(req)))));
purchasingRouter.delete("/returns/:id", requirePermission("purchasing.manage"), asyncHandler(async (req, res) => {
  await returns.deleteDraftPurchaseReturn(id(req), await actorOf(req));
  res.status(204).end();
}));
purchasingRouter.post("/returns/:id/approve", requirePermission("purchasing.approve"), asyncHandler(async (req, res) => res.json(await returns.approvePurchaseReturn(id(req), await actorOf(req)))));
purchasingRouter.post("/returns/:id/reopen", requirePermission("purchasing.manage"), asyncHandler(async (req, res) => res.json(await returns.reopenPurchaseReturn(id(req), await actorOf(req)))));
purchasingRouter.post("/returns/:id/cancel", requirePermission("purchasing.manage"), validate(purchaseOrderReasonSchema), asyncHandler(async (req, res) => res.json(await returns.cancelPurchaseReturn(id(req), reason(req), await actorOf(req)))));
purchasingRouter.post("/returns/:id/ship", requirePermission("purchasing.receive"), asyncHandler(async (req, res) => res.json(await returns.shipPurchaseReturn(id(req), await actorOf(req)))));

// ── Phase 4E: supplier invoices, credit notes and payables (docs/FINANCE_PHASE_4E.md) ───────────────────────────────────
purchasingRouter.get("/supplier-invoices", requirePermission("ap.read"), validate(supplierInvoiceListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await invoices.listSupplierInvoices(req.query as never))));
purchasingRouter.get("/supplier-invoices/open-items", requirePermission("ap.read"), validate(supplierOpenItemsQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await invoices.supplierOpenItems((req.query as { supplierId: string }).supplierId))));
purchasingRouter.get("/supplier-invoices/:id", requirePermission("ap.read"), asyncHandler(async (req, res) => res.json(await invoices.getSupplierInvoice(id(req)))));
purchasingRouter.post("/supplier-invoices", requirePermission("ap.manage"), validate(supplierInvoiceCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await invoices.createSupplierInvoice(req.body, await actorOf(req)))));
purchasingRouter.patch("/supplier-invoices/:id", requirePermission("ap.manage"), validate(supplierInvoiceUpdateSchema), asyncHandler(async (req, res) => res.json(await invoices.updateSupplierInvoice(id(req), req.body, await actorOf(req)))));
purchasingRouter.delete("/supplier-invoices/:id", requirePermission("ap.manage"), asyncHandler(async (req, res) => {
  await invoices.deleteDraftSupplierInvoice(id(req), await actorOf(req));
  res.status(204).end();
}));
purchasingRouter.post("/supplier-invoices/:id/post", requirePermission("ap.manage"), validate(supplierInvoicePostSchema), asyncHandler(async (req, res) => res.json(await invoices.postSupplierInvoice(id(req), req.body, await actorOf(req)))));
purchasingRouter.post("/supplier-invoices/:id/void", requirePermission("ap.manage"), validate(supplierInvoiceVoidSchema), asyncHandler(async (req, res) => res.json(await invoices.voidSupplierInvoice(id(req), reason(req), await actorOf(req)))));
purchasingRouter.get("/payables/ageing", requirePermission("ap.read"), asyncHandler(async (_req, res) => res.json(await invoices.payablesAgeing())));

// ── Phase 4F: supplier payments and allocations (docs/FINANCE_PHASE_4F.md) — approval / reversal via /finance/movements ──
purchasingRouter.post("/supplier-payments", requirePermission("ap.manage"), validate(supplierPaymentCreateSchema), asyncHandler(async (req, res) => {
  const r = await payments.paySupplier(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
purchasingRouter.post("/supplier-allocations", requirePermission("ap.manage"), validate(supplierAllocationCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await payments.allocateToBill(req.body, await actorOf(req)))));
purchasingRouter.post("/supplier-refunds", requirePermission("ap.manage"), validate(supplierRefundSchema), asyncHandler(async (req, res) => {
  const r = await payments.refundFromSupplier(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
purchasingRouter.post("/supplier-allocations/:id/release", requirePermission("ap.manage"), validate(supplierAllocationReleaseSchema), asyncHandler(async (req, res) => res.json(await payments.releaseAllocation(id(req), reason(req), await actorOf(req)))));
purchasingRouter.get("/suppliers/:id/account", requirePermission("ap.read"), validate(supplierAccountQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await payments.supplierAccount(id(req), req.query as never))));

// ── Phase 4G: reports (docs/FINANCE_PHASE_4G.md) — read-only, each total ties to its account or check ───────────────────
const reportQuery = validate(purchasingReportQuerySchema, "query");
purchasingRouter.get("/reports/purchase-register", requirePermission("purchasing.read"), reportQuery, asyncHandler(async (req, res) => res.json(await reports.purchaseRegister(req.query as never))));
purchasingRouter.get("/reports/grni-ageing", requirePermission("purchasing.read"), asyncHandler(async (_req, res) => res.json(await reports.grniAgeing())));
purchasingRouter.get("/reports/price-variance", requirePermission("purchasing.read"), reportQuery, asyncHandler(async (req, res) => res.json(await reports.priceVariance(req.query as never))));
purchasingRouter.get("/reports/inventory-valuation", requirePermission("costing.read"), reportQuery, asyncHandler(async (req, res) => res.json(await reports.inventoryValuation(req.query as never))));
purchasingRouter.get("/reports/cost-adjustments", requirePermission("costing.read"), reportQuery, asyncHandler(async (req, res) => res.json(await reports.costAdjustments(req.query as never))));
purchasingRouter.get("/reports/supplier-payments", requirePermission("ap.read"), reportQuery, asyncHandler(async (req, res) => res.json(await reports.paymentsRegister(req.query as never))));
