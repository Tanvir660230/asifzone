import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { processPaymentMethodLogo } from "../uploads/upload.service";
import * as paymentMethodService from "./payment-method.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ methods: await paymentMethodService.listPaymentMethods() });
});

export const active = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ methods: await paymentMethodService.getActivePaymentMethods() });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const method = await paymentMethodService.createPaymentMethod(req.body);
  res.status(201).json({ method });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ method: await paymentMethodService.updatePaymentMethod(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await paymentMethodService.deletePaymentMethod(req.params.id!);
  res.status(204).send();
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  await paymentMethodService.reorderPaymentMethods(req.body);
  res.status(204).send();
});

export const uploadLogo = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processPaymentMethodLogo(req.file.buffer);
  res.status(201).json({ url });
});
