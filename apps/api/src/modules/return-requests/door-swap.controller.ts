import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler";
import { idempotencyKeyOf } from "../orders/order.controller";
import { createDoorSwap, listOrderExchanges } from "./door-swap.service";
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

export const resolveIssueSchema = z.object({ resolution: z.string().trim().min(3).max(200) });
export const resolveIssue = asyncHandler(async (req: Request, res: Response) => {
  await resolveOrderIssue(req.params.id!, req.params.issueId!, req.body.resolution);
  res.status(204).end();
});
