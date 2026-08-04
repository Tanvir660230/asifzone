import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as wishlistService from "./wishlist.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const items = await wishlistService.listWishlist(req.customer!.customerId);
  res.json({ items });
});

export const add = asyncHandler(async (req: Request, res: Response) => {
  await wishlistService.addToWishlist(req.customer!.customerId, req.body.productId);
  res.status(201).json({ ok: true });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await wishlistService.removeFromWishlist(req.customer!.customerId, req.params.productId!);
  res.status(204).send();
});
