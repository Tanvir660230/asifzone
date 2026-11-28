import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { idempotencyKeyOf } from "../orders/order.controller";
import { createDoorSwap, listOrderExchanges } from "./door-swap.service";
import { settleDoorSwap } from "./door-swap-outcome.service";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { createOrderIssue, listOrderIssues, resolveOrderIssue } from "./order-issue.service";

export const createExchange = asyncHandler(async (req: Request, res: Response) => {
  const result = await createDoorSwap(req.params.id!, req.body, req.admin!.adminId, idempotencyKeyOf(req));
  res.status(result.preview ? 200 : 201).json(result);
});

export const listExchanges = asyncHandler(async (req: Request, res: Response) => {
  res.json({ exchanges: await listOrderExchanges(req.params.id!) });
});

export const createIssue = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json({ issue: await createOrderIssue(req.params.id!, req.body, { adminId: req.admin!.adminId }) });
});

export const listIssues = asyncHandler(async (req: Request, res: Response) => {
  res.json({ issues: (await listOrderIssues([req.params.id!])).get(req.params.id!) ?? [] });
});

export const swapOutcomeSchema = z.object({
  outcome: z.enum(["SWAPPED", "KEPT_BOTH", "REFUSED", "CANCELLED", "OLD_MISSING"]),
  note: z.string().trim().max(300).nullable().optional(),
});
export const setOutcome = asyncHandler(async (req: Request, res: Response) => {
  const own = await prisma.returnRequest.findFirst({ where: { id: req.params.requestId!, orderId: req.params.id! }, select: { id: true } });
  if (!own) throw AppError.notFound("Exchange not found on this order");
  await settleDoorSwap(own.id, req.body.outcome, { adminId: req.admin!.adminId, source: "STAFF" }, req.body.note ?? null);
  res.json({ exchanges: await listOrderExchanges(req.params.id!) });
});

export const resolveIssueSchema = z.object({ resolution: z.string().trim().min(3).max(200) });
export const resolveIssue = asyncHandler(async (req: Request, res: Response) => {
  await resolveOrderIssue(req.params.id!, req.params.issueId!, req.body.resolution);
  res.status(204).end();
});
