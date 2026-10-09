import { Router, type NextFunction, type Request, type Response } from "express";
import {
  bomCreateSchema,
  bomListQuerySchema,
  bomUpdateSchema,
  costCategoryCreateSchema,
  costCategoryUpdateSchema,
  materialCreateSchema,
  materialListQuerySchema,
  materialUpdateSchema,
  productionOrderCreateSchema,
  productionOrderListQuerySchema,
  productionOrderReasonSchema,
  productionOrderUpdateSchema,
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
