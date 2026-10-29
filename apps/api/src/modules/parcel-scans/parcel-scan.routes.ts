import { Router } from "express";
import { z } from "zod";
import { businessDate, businessDayStartUtc, createScanBatchSchema, PARCEL_SCAN_KINDS, recordScanSchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { getTimezone } from "../../domain/config/commerce-settings";
import * as scans from "./parcel-scan.service";
import { latestCourierAutomation, runCourierAutomation } from "./courier-automation.service";

/** /api/parcel-scans — dispatch and return scanning (Order Operations phase 4). parcels.scan throughout: a scan records
 * a physical handover / receipt only; inspection (the restock) stays on the order, under returns.manage. */
export const parcelScanRouter = Router();
parcelScanRouter.use(requireAdmin);

const kindQuery = z.object({ kind: z.enum(PARCEL_SCAN_KINDS) });

parcelScanRouter.get(
  "/batches/current", requirePermission("parcels.scan"), validate(kindQuery, "query"),
  asyncHandler(async (req, res) => {
    res.json({ batch: await scans.currentBatch(req.admin!.adminId, req.query.kind as "DISPATCH" | "RETURN") });
  }),
);
parcelScanRouter.post(
  "/batches", requirePermission("parcels.scan"), validate(createScanBatchSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await scans.createBatch(req.admin!.adminId, req.body.kind, req.body.note));
  }),
);
parcelScanRouter.get(
  "/batches/:id", requirePermission("parcels.scan"),
  asyncHandler(async (req, res) => {
    res.json(await scans.getBatch(req.params.id!));
  }),
);
parcelScanRouter.post(
  "/batches/:id/scans", requirePermission("parcels.scan"), validate(recordScanSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await scans.recordScan(req.params.id!, req.admin!.adminId, req.body));
  }),
);
parcelScanRouter.delete(
  "/batches/:id/scans/:eventId", requirePermission("parcels.scan"),
  asyncHandler(async (req, res) => {
    res.json(await scans.voidScan(req.params.id!, req.params.eventId!));
  }),
);
parcelScanRouter.post(
  "/batches/:id/confirm", requirePermission("parcels.scan"),
  asyncHandler(async (req, res) => {
    res.json(await scans.confirmBatch(req.params.id!, req.admin!.adminId));
  }),
);
parcelScanRouter.post(
  "/batches/:id/cancel", requirePermission("parcels.scan"),
  asyncHandler(async (req, res) => {
    res.json(await scans.cancelBatch(req.params.id!));
  }),
);
parcelScanRouter.get(
  "/summary", requirePermission("parcels.scan"),
  asyncHandler(async (_req, res) => {
    const tz = await getTimezone();
    res.json(await scans.dispatchSummary(businessDayStartUtc(businessDate(new Date(), tz), tz)));
  }),
);

/** The daily courier check (phase 5): its latest run for the scanning pages; an owner can run it now. */
parcelScanRouter.get(
  "/automation", requirePermission("parcels.scan"),
  asyncHandler(async (_req, res) => {
    res.json({ run: await latestCourierAutomation() });
  }),
);
parcelScanRouter.post(
  "/automation/run", requirePermission("courier_costs.record"),
  asyncHandler(async (_req, res) => {
    res.json({ run: await runCourierAutomation() });
  }),
);
