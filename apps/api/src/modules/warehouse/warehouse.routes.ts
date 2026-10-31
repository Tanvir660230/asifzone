import { Router } from "express";
import { pickListRequestSchema, printRunListQuerySchema, productLabelQuerySchema, recordPrintRunSchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import * as warehouse from "./warehouse.service";

/** /api/warehouse — picking, packing sheets and the print log (docs/WAREHOUSE_OPERATIONS.md §3). Reading what to pick is
 * orders.read; recording a print is orders.manage (the people who prepare orders). Nothing here changes stock, an order's
 * status, a handover or money. */
export const warehouseRouter = Router();
warehouseRouter.use(requireAdmin);

warehouseRouter.post(
  "/pick-list", requirePermission("orders.read"), validate(pickListRequestSchema),
  asyncHandler(async (req, res) => {
    res.json(await warehouse.buildPickList(req.body.orderIds));
  }),
);
warehouseRouter.get(
  "/product-labels", requirePermission("orders.read"), validate(productLabelQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    res.json({ variants: await warehouse.listProductLabelVariants(req.query as never) });
  }),
);
warehouseRouter.get(
  "/print-runs", requirePermission("orders.read"), validate(printRunListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    res.json({ runs: await warehouse.listPrintRuns(req.query as never) });
  }),
);
warehouseRouter.post(
  "/print-runs", requirePermission("orders.manage"), validate(recordPrintRunSchema),
  asyncHandler(async (req, res) => {
    const { run, created } = await warehouse.recordPrintRun(req.admin!.adminId, req.body);
    res.status(created ? 201 : 200).json({ run });
  }),
);
