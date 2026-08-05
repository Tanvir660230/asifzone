import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as stockAlertService from "./stock-alert.service";

export const subscribe = asyncHandler(async (req: Request, res: Response) => {
  await stockAlertService.subscribe(req.customer!.customerId, req.body.variantId);
  res.status(201).json({ ok: true });
});

export const unsubscribe = asyncHandler(async (req: Request, res: Response) => {
  await stockAlertService.unsubscribe(req.customer!.customerId, req.params.variantId!);
  res.status(204).send();
});
