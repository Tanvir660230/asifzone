import { Router } from "express";
import { labelBatchSchema, pickListRequestSchema, printRunListQuerySchema, productLabelQuerySchema, recordPrintRunSchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import * as warehouse from "./warehouse.service";
import * as labelBatches from "./label-batches.service";

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

// Supplier lists for product stickers: read with orders.read, saved by the people who prepare orders (orders.manage).
warehouseRouter.get(
  "/label-batches", requirePermission("orders.read"),
  asyncHandler(async (_req, res) => {
    res.json({ batches: await labelBatches.listLabelBatches() });
  }),
);
warehouseRouter.get(
  "/label-batches/:id", requirePermission("orders.read"),
  asyncHandler(async (req, res) => {
    res.json({ batch: await labelBatches.getLabelBatch(String(req.params.id)) });
  }),
);
warehouseRouter.post(
  "/label-batches", requirePermission("orders.manage"), validate(labelBatchSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ batch: await labelBatches.createLabelBatch(req.admin!.adminId, req.body) });
  }),
);
warehouseRouter.put(
  "/label-batches/:id", requirePermission("orders.manage"), validate(labelBatchSchema),
  asyncHandler(async (req, res) => {
    res.json({ batch: await labelBatches.updateLabelBatch(String(req.params.id), req.body) });
  }),
);
warehouseRouter.delete(
  "/label-batches/:id", requirePermission("orders.manage"),
  asyncHandler(async (req, res) => {
    await labelBatches.deleteLabelBatch(String(req.params.id));
    res.status(204).end();
  }),
);
