import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { can } from "../../domain/auth/authorization";
import { endOrderHold, placeOrderHold } from "./order-hold.service";

/** Order hold (docs/ORDER_HOLD.md) — see order-hold.service.ts. */

export const place = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await placeOrderHold(req.params.id!, req.body, req.admin!.adminId, { canOverride: can(req.admin, "orders.escalations") }) });
});

export const end = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await endOrderHold(req.params.id!, req.admin!.adminId) });
});
