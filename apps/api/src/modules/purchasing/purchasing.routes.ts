import { Router, type NextFunction, type Request, type Response } from "express";
import { supplierCreateSchema, supplierListQuerySchema, supplierStatusSchema, supplierUpdateSchema, taxCodeCreateSchema, taxCodeUpdateSchema } from "@clothing-brand/shared";
import { z } from "zod";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { actorOf } from "../finance/finance.routes";
import * as suppliers from "../../domain/finance/suppliers.service";
import * as taxCodes from "../../domain/finance/tax-codes.service";
import { ensurePurchasingAccounting, purchasingStatus } from "../../domain/finance/purchasing-setup.service";

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
