import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as inventoryService from "./inventory.service";

export const listMovements = asyncHandler(async (req: Request, res: Response) => {
  res.json(await inventoryService.listStockMovements(req.query as never));
});

export const adjust = asyncHandler(async (req: Request, res: Response) => {
  const { delta, reason, note } = req.body;
  const variant = await inventoryService.adjustVariantStock(req.params.variantId!, delta, reason, req.admin!.adminId, note);
  res.json({ variant });
});

export const reconciliation = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ discrepancies: await inventoryService.getStockDiscrepancies() });
});
