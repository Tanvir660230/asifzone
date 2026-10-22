import { Router, type Request, type Response } from "express";
import {
  shipmentClearReviewSchema,
  shipmentCostUpdateSchema,
  shipmentCreateSchema,
  shipmentReconcileSchema,
  shipmentReopenSchema,
  shipmentReportQuerySchema,
} from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { can } from "../../domain/auth/authorization";
import { idempotencyKeyOf } from "../orders/order.controller";
import * as shipments from "../../domain/shipments/shipment.service";
import { refreshShipmentFromCourier, syncCourierPayouts } from "../../domain/shipments/courier-evidence";

/** Courier cost reconciliation (docs/COURIER_COSTS.md). Reading needs courier_costs.read; recording courier_costs.record;
 * verifying a figure, deciding a treatment and reconciling need courier_costs.verify (checked per field in the service,
 * and on the routes that only verify). */
export const shipmentRouter = Router();

const actor = (req: Request): shipments.ShipmentActor => ({ adminId: req.admin!.adminId, canVerify: can(req.admin, "courier_costs.verify") });

shipmentRouter.get(
  "/report",
  requireAdmin,
  requirePermission("courier_costs.read"),
  validate(shipmentReportQuerySchema, "query"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await shipments.shipmentReport(req.query as never));
  }),
);

// Walks the courier's payouts: payout, booked COD and collected cash per parcel; charges where the payout's total proves them.
shipmentRouter.post(
  "/payouts/sync",
  requireAdmin,
  requirePermission("courier_costs.record"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await syncCourierPayouts());
  }),
);

shipmentRouter.get(
  "/orders/:orderId",
  requireAdmin,
  requirePermission("courier_costs.read"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await shipments.listOrderShipments(req.params.orderId!));
  }),
);

shipmentRouter.post(
  "/orders/:orderId",
  requireAdmin,
  requirePermission("courier_costs.record"),
  validate(shipmentCreateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json({ shipment: await shipments.createShipmentLeg(req.params.orderId!, req.body, actor(req), idempotencyKeyOf(req)) });
  }),
);

shipmentRouter.patch(
  "/:id/costs",
  requireAdmin,
  requirePermission("courier_costs.record"),
  validate(shipmentCostUpdateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ shipment: await shipments.updateShipmentCosts(req.params.id!, req.body, actor(req)) });
  }),
);

shipmentRouter.post(
  "/:id/refresh",
  requireAdmin,
  requirePermission("courier_costs.record"),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await refreshShipmentFromCourier(req.params.id!);
    res.json({ ...result, data: await shipments.listOrderShipments((await shipments.orderIdOfShipment(req.params.id!))) });
  }),
);

shipmentRouter.post(
  "/:id/reconcile",
  requireAdmin,
  requirePermission("courier_costs.verify"),
  validate(shipmentReconcileSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ shipment: await shipments.reconcileShipment(req.params.id!, req.body, actor(req)) });
  }),
);

shipmentRouter.post(
  "/:id/reopen",
  requireAdmin,
  requirePermission("courier_costs.verify"),
  validate(shipmentReopenSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ shipment: await shipments.reopenShipment(req.params.id!, req.body, actor(req)) });
  }),
);

shipmentRouter.post(
  "/:id/clear-review",
  requireAdmin,
  requirePermission("courier_costs.verify"),
  validate(shipmentClearReviewSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ shipment: await shipments.clearShipmentReview(req.params.id!, req.body, actor(req)) });
  }),
);
