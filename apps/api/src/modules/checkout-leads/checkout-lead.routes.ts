import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { captureCheckoutLeadSchema, recordCheckoutLeadActionSchema } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { checkoutLeadCaptureRateLimit, checkoutLeadResumeRateLimit } from "../../middlewares/rate-limit";
import { AppError } from "../../lib/app-error";
import * as leads from "./checkout-lead.service";

/** Incomplete orders (docs/INCOMPLETE_ORDERS.md). Public: the storefront's capture and the resume link. Admin: the list,
 * one lead, the summary and the call outcomes. */
export const checkoutLeadRouter = Router();

const listQuery = z.object({ view: z.enum(["open", "closed"]).default("open") });
const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });

checkoutLeadRouter.post(
  "/capture",
  checkoutLeadCaptureRateLimit,
  attachCustomerIfPresent,
  validate(captureCheckoutLeadSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await leads.captureCheckoutLead(req.body, { customerId: req.customer?.customerId ?? null }));
  }),
);

checkoutLeadRouter.get(
  "/resume/:code",
  checkoutLeadResumeRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const lead = await leads.resumeCheckoutLead(req.params.code!);
    if (!lead) throw AppError.notFound("This link has expired");
    res.json({ lead });
  }),
);

checkoutLeadRouter.get(
  "/",
  requireAdmin,
  requirePermission("orders.read"),
  validate(listQuery, "query"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ leads: await leads.listCheckoutLeads((req.query as unknown as z.infer<typeof listQuery>).view) });
  }),
);

checkoutLeadRouter.get(
  "/summary",
  requireAdmin,
  requirePermission("orders.read"),
  validate(summaryQuery, "query"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await leads.checkoutLeadSummary((req.query as unknown as z.infer<typeof summaryQuery>).days));
  }),
);

checkoutLeadRouter.get(
  "/:id",
  requireAdmin,
  requirePermission("orders.read"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ lead: await leads.getCheckoutLead(req.params.id!) });
  }),
);

checkoutLeadRouter.post(
  "/:id/actions",
  requireAdmin,
  requirePermission("orders.manage"),
  validate(recordCheckoutLeadActionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ lead: await leads.recordCheckoutLeadAction(req.params.id!, req.body, req.admin!.adminId) });
  }),
);
