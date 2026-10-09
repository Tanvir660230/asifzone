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
  purchasingSettingsSchema,
  supplierCreateSchema,
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
