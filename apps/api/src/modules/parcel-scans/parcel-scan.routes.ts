import { Router } from "express";
import { z } from "zod";
import {
  businessDate,
  businessDayStartUtc,
  correctParcelReceiptSchema,
  createScanBatchSchema,
  handOverFromListSchema,
  linkParcelCodeSchema,
  PARCEL_SCAN_KINDS,
  receiveParcelSchema,
  recordScanSchema,
  resolveParcelCodeSchema,
} from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { getTimezone } from "../../domain/config/commerce-settings";
import { idempotencyKeyOf } from "../orders/order.controller";
import * as scans from "./parcel-scan.service";
import { latestCourierAutomation, runCourierAutomation } from "./courier-automation.service";
import { linkParcelCode, resolveParcelCode } from "./parcel-resolve.service";
import { correctParcelReceipt, getParcelView, receiveParcel } from "./parcel-receive.service";

/** /api/parcel-scans — dispatch and return scanning (Order Operations phase 4) and the scanner page's receive and
 * inspect. parcels.scan for scanning and looking (a scan records a physical handover / receipt only); returns.manage to
 * receive and inspect (the step that restocks), plus payments.record for the courier's money. */
export const parcelScanRouter = Router();
parcelScanRouter.use(requireAdmin);

const kindQuery = z.object({ kind: z.enum(PARCEL_SCAN_KINDS) });

/** What a scanned code names — nothing changes. */
parcelScanRouter.post(
  "/resolve", requirePermission("parcels.scan"), validate(resolveParcelCodeSchema),
  asyncHandler(async (req, res) => {
    res.json(await resolveParcelCode(req.body.code, req.body.mode));
  }),
);
parcelScanRouter.get(
  "/parcels/:orderId", requirePermission("parcels.scan"),
  asyncHandler(async (req, res) => {
    res.json(await getParcelView(req.params.orderId!, req.admin!));
  }),
);
/** One confirmed physical receipt (parcel-receive.service). The Idempotency-Key is required: a retried confirm (network,
 * double click) returns the first receipt. */
parcelScanRouter.post(
  "/receive", requirePermission("returns.manage"), validate(receiveParcelSchema),
  asyncHandler(async (req, res) => {
    const key = idempotencyKeyOf(req);
    if (!key) throw AppError.badRequest("Idempotency-Key header is required", { code: "IDEMPOTENCY_KEY_REQUIRED" });
    const result = await receiveParcel(req.body, req.admin!, key);
    res.status(result.replayed ? 200 : 201).json(result);
  }),
);
parcelScanRouter.post(
  "/receipts/:id/correct", requirePermission("returns.manage"), validate(correctParcelReceiptSchema),
  asyncHandler(async (req, res) => {
    res.json(await correctParcelReceipt(req.params.id!, req.body, req.admin!, idempotencyKeyOf(req)));
  }),
);
parcelScanRouter.post(
  "/aliases", requirePermission("returns.manage"), validate(linkParcelCodeSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await linkParcelCode(req.body.code, req.body.orderId, req.admin!.adminId));
  }),
);

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
/** The rider took these — handed over from the orders list, no scanner (scans.handOverFromList). */
parcelScanRouter.post(
  "/handover", requirePermission("parcels.scan"), validate(handOverFromListSchema),
  asyncHandler(async (req, res) => {
    res.json(await scans.handOverFromList(req.admin!.adminId, req.body.orderIds, req.body.note));
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
