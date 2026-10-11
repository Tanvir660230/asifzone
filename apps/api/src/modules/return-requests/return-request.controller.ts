import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as returnRequestService from "./return-request.service";
import { toCustomerReturnRequest } from "../orders/customer-order-view";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const request = await returnRequestService.createReturnRequest(req.customer!.customerId, req.body);
  res.status(201).json({ request: toCustomerReturnRequest(request) });
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const result = await returnRequestService.listMyReturnRequests(req.customer!.customerId, req.query as never);
  res.json({ ...result, items: result.items.map(toCustomerReturnRequest) });
});

// --- admin ---

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await returnRequestService.listReturnRequestsAdmin(req.query as never));
});

export const exchangePreview = asyncHandler(async (req: Request, res: Response) => {
  res.json({ preview: await returnRequestService.previewExchange(req.params.id!) });
});

export const review = asyncHandler(async (req: Request, res: Response) => {
  const request = await returnRequestService.reviewReturnRequest(req.params.id!, req.body, req.admin!.adminId);
  res.json({ request });
});
