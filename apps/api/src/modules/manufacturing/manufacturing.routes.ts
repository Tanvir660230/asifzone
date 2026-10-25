import { Router, type NextFunction, type Request, type Response } from "express";
import {
  bomCreateSchema,
  bomListQuerySchema,
  bomUpdateSchema,
  costCategoryCreateSchema,
  costCategoryUpdateSchema,
  materialIssueSchema,
  materialReturnSchema,
  materialUsageSchema,
  materialCreateSchema,
  materialListQuerySchema,
  materialUpdateSchema,
  productionCostCreateSchema,
  productionCostUpdateSchema,
  productionCostVoidSchema,
  productionOrderCreateSchema,
  productionOrderCloseSchema,
  productionOrderListQuerySchema,
  productionOrderReasonSchema,
  productionOrderUpdateSchema,
  productionReceiptCreateSchema,
  productionReceiptPostSchema,
} from "@clothing-brand/shared";
import { z } from "zod";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { actorOf } from "../finance/finance.routes";
import * as setup from "../../domain/manufacturing/manufacturing-setup.service";
import * as materials from "../../domain/manufacturing/materials.service";
import * as boms from "../../domain/manufacturing/boms.service";
import * as orders from "../../domain/manufacturing/production-orders.service";
import * as custody from "../../domain/manufacturing/material-custody.service";
import * as costs from "../../domain/manufacturing/production-costs.service";
import * as receipts from "../../domain/manufacturing/production-receipts.service";
import * as closing from "../../domain/manufacturing/production-close.service";
import * as reports from "../../domain/manufacturing/production-reports.service";
import { idempotencyKeyOf } from "../orders/order.controller";

/**
 * Manufacturing (docs/MANUFACTURING.md) — /api/v1/manufacturing. STAFF plans and runs production; approving plans, BOM
 * versions, cost categories and (later) costs and closing stay with approvers. Costs — planned costs, material averages —
 * are shown only to admins holding costing.read. Every change is recorded in the financial audit trail by the service.
 */
export const manufacturingRouter = Router();

manufacturingRouter.use(requireAdmin);
manufacturingRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals.auditHandled = true;
  next();
});

const id = (req: Request) => req.params.id!;
const costView = (req: Request) => ({ canSeeCost: req.admin!.permissions.includes("costing.read") });
const reason = (req: Request) => (req.body as { reason: string }).reason;

manufacturingRouter.get("/status", requirePermission("manufacturing.read"), asyncHandler(async (_req, res) => res.json(await setup.manufacturingStatus())));
manufacturingRouter.post("/setup", requirePermission("finance.configure"), asyncHandler(async (req, res) => res.json(await setup.ensureManufacturingSetup(await actorOf(req)))));

manufacturingRouter.get("/products", requirePermission("manufacturing.read"), validate(z.object({ q: z.string().trim().max(100).optional(), take: z.coerce.number().int().min(1).max(50).default(20) }), "query"), asyncHandler(async (req, res) => res.json(await orders.searchProducibleProducts(req.query as never))));

manufacturingRouter.get("/cost-categories", requirePermission("manufacturing.read"), validate(z.object({ activeOnly: z.enum(["true", "false"]).optional() }), "query"), asyncHandler(async (req, res) => res.json(await setup.listCostCategories(req.query.activeOnly === "true"))));
manufacturingRouter.post("/cost-categories", requirePermission("manufacturing.approve"), validate(costCategoryCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await setup.createCostCategory(req.body, await actorOf(req)))));
manufacturingRouter.patch("/cost-categories/:id", requirePermission("manufacturing.approve"), validate(costCategoryUpdateSchema), asyncHandler(async (req, res) => res.json(await setup.updateCostCategory(id(req), req.body, await actorOf(req)))));

manufacturingRouter.get("/materials", requirePermission("manufacturing.read"), validate(materialListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await materials.listMaterials({ q: req.query.q as string | undefined, includeArchived: req.query.includeArchived === "true" }, costView(req)))));
manufacturingRouter.post("/materials", requirePermission("manufacturing.manage"), validate(materialCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await materials.createMaterial(req.body, await actorOf(req), costView(req)))));
manufacturingRouter.patch("/materials/:id", requirePermission("manufacturing.manage"), validate(materialUpdateSchema), asyncHandler(async (req, res) => res.json(await materials.updateMaterial(id(req), req.body, await actorOf(req), costView(req)))));
manufacturingRouter.post("/materials/:id/archive", requirePermission("manufacturing.manage"), asyncHandler(async (req, res) => res.json(await materials.archiveMaterial(id(req), await actorOf(req), costView(req)))));
manufacturingRouter.post("/materials/:id/restore", requirePermission("manufacturing.manage"), asyncHandler(async (req, res) => res.json(await materials.restoreMaterial(id(req), await actorOf(req), costView(req)))));

manufacturingRouter.get("/boms", requirePermission("manufacturing.read"), validate(bomListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await boms.listBoms(req.query as never))));
manufacturingRouter.get("/boms/:id", requirePermission("manufacturing.read"), asyncHandler(async (req, res) => res.json(await boms.getBom(id(req)))));
manufacturingRouter.post("/boms", requirePermission("manufacturing.manage"), validate(bomCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await boms.createBom(req.body, await actorOf(req)))));
manufacturingRouter.patch("/boms/:id", requirePermission("manufacturing.manage"), validate(bomUpdateSchema), asyncHandler(async (req, res) => res.json(await boms.updateBom(id(req), req.body, await actorOf(req)))));
manufacturingRouter.delete("/boms/:id", requirePermission("manufacturing.manage"), asyncHandler(async (req, res) => {
  await boms.deleteDraftBom(id(req), await actorOf(req));
  res.status(204).end();
}));
manufacturingRouter.post("/boms/:id/copy", requirePermission("manufacturing.manage"), asyncHandler(async (req, res) => res.status(201).json(await boms.copyBom(id(req), await actorOf(req)))));
manufacturingRouter.post("/boms/:id/approve", requirePermission("manufacturing.approve"), asyncHandler(async (req, res) => res.json(await boms.approveBom(id(req), await actorOf(req)))));
manufacturingRouter.post("/boms/:id/archive", requirePermission("manufacturing.approve"), asyncHandler(async (req, res) => res.json(await boms.archiveBom(id(req), await actorOf(req)))));

manufacturingRouter.get("/production-orders", requirePermission("manufacturing.read"), validate(productionOrderListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await orders.listProductionOrders(req.query as never, costView(req)))));
manufacturingRouter.get("/production-orders/:id", requirePermission("manufacturing.read"), asyncHandler(async (req, res) => res.json(await orders.getProductionOrder(id(req), costView(req)))));
manufacturingRouter.post("/production-orders", requirePermission("manufacturing.manage"), validate(productionOrderCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await orders.createProductionOrder(req.body, await actorOf(req), costView(req)))));
manufacturingRouter.patch("/production-orders/:id", requirePermission("manufacturing.manage"), validate(productionOrderUpdateSchema), asyncHandler(async (req, res) => res.json(await orders.updateProductionOrder(id(req), req.body, await actorOf(req), costView(req)))));
manufacturingRouter.delete("/production-orders/:id", requirePermission("manufacturing.manage"), asyncHandler(async (req, res) => {
  await orders.deleteDraftProductionOrder(id(req), await actorOf(req));
  res.status(204).end();
}));
manufacturingRouter.post("/production-orders/:id/approve", requirePermission("manufacturing.approve"), asyncHandler(async (req, res) => res.json(await orders.approveProductionOrder(id(req), await actorOf(req), costView(req)))));
manufacturingRouter.post("/production-orders/:id/reopen", requirePermission("manufacturing.approve"), asyncHandler(async (req, res) => res.json(await orders.reopenProductionOrder(id(req), await actorOf(req), costView(req)))));
manufacturingRouter.post("/production-orders/:id/cancel", requirePermission("manufacturing.manage"), validate(productionOrderReasonSchema), asyncHandler(async (req, res) => res.json(await orders.cancelProductionOrder(id(req), reason(req), await actorOf(req), costView(req)))));

// ── M2: materials custody (docs/MANUFACTURING.md §6) — an Idempotency-Key makes a retried issue / return a no-op ─────
manufacturingRouter.get("/production-orders/:id/moves", requirePermission("manufacturing.read"), asyncHandler(async (req, res) => res.json(await custody.listMaterialMoves(id(req)))));
manufacturingRouter.post("/production-orders/:id/issue", requirePermission("manufacturing.move_stock"), validate(materialIssueSchema), asyncHandler(async (req, res) => res.json(await custody.issueMaterials(id(req), req.body, await actorOf(req), { ...costView(req), requestKey: idempotencyKeyOf(req) }))));
manufacturingRouter.post("/production-orders/:id/return", requirePermission("manufacturing.move_stock"), validate(materialReturnSchema), asyncHandler(async (req, res) => res.json(await custody.returnMaterials(id(req), req.body, await actorOf(req), { ...costView(req), requestKey: idempotencyKeyOf(req) }))));
manufacturingRouter.put("/production-orders/:id/material-usage", requirePermission("manufacturing.manage"), validate(materialUsageSchema), asyncHandler(async (req, res) => res.json(await custody.declareMaterialUsage(id(req), req.body, await actorOf(req), costView(req)))));

// ── M3: production costs (docs/MANUFACTURING.md §7) — entered by production staff, approved by someone else ──────────
manufacturingRouter.post("/production-orders/:id/costs", requirePermission("manufacturing.manage"), validate(productionCostCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await costs.createCostEntry(id(req), req.body, await actorOf(req)))));
manufacturingRouter.patch("/production-costs/:id", requirePermission("manufacturing.manage"), validate(productionCostUpdateSchema), asyncHandler(async (req, res) => res.json(await costs.updateCostEntry(id(req), req.body, await actorOf(req)))));
manufacturingRouter.delete("/production-costs/:id", requirePermission("manufacturing.manage"), asyncHandler(async (req, res) => {
  await costs.deleteDraftCostEntry(id(req), await actorOf(req));
  res.status(204).end();
}));
manufacturingRouter.post("/production-costs/:id/approve", requirePermission("manufacturing.approve"), asyncHandler(async (req, res) => res.json(await costs.approveCostEntry(id(req), await actorOf(req)))));
manufacturingRouter.post("/production-costs/:id/void", requirePermission("manufacturing.approve"), validate(productionCostVoidSchema), asyncHandler(async (req, res) => res.json(await costs.voidCostEntry(id(req), reason(req), await actorOf(req)))));

// ── M4: deliveries, inspection and finished goods (docs/MANUFACTURING.md §8) ─────────────────────────────────────────
manufacturingRouter.post("/production-orders/:id/receipts", requirePermission("manufacturing.manage"), validate(productionReceiptCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await receipts.createProductionReceipt(id(req), req.body, await actorOf(req), costView(req)))));
manufacturingRouter.delete("/production-receipts/:id", requirePermission("manufacturing.manage"), asyncHandler(async (req, res) => {
  await receipts.deleteDraftProductionReceipt(id(req), await actorOf(req));
  res.status(204).end();
}));
manufacturingRouter.post("/production-receipts/:id/post", requirePermission("manufacturing.move_stock"), validate(productionReceiptPostSchema), asyncHandler(async (req, res) => res.json(await receipts.postProductionReceipt(id(req), req.body, await actorOf(req), costView(req)))));
manufacturingRouter.post("/production-receipts/:id/reverse", requirePermission("manufacturing.approve"), validate(productionCostVoidSchema), asyncHandler(async (req, res) => res.json(await receipts.reverseProductionReceipt(id(req), reason(req), await actorOf(req), costView(req)))));
manufacturingRouter.post("/production-orders/:id/close", requirePermission("manufacturing.approve"), validate(productionOrderCloseSchema), asyncHandler(async (req, res) => res.json(await closing.closeProductionOrder(id(req), req.body, await actorOf(req), costView(req)))));
manufacturingRouter.get("/overview", requirePermission("manufacturing.read"), asyncHandler(async (req, res) => res.json(await reports.manufacturingOverview(costView(req)))));
