import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as cartService from "./cart.service";

export const sync = asyncHandler(async (req: Request, res: Response) => {
  await cartService.syncCart(req.customer!.customerId, req.body);
  res.status(204).send();
});
