import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as reviewService from "./review.service";

export const listForProduct = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reviewService.listReviewsForProduct(req.query as never));
});

export const getMine = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = req.query as { productId: string };
  const review = await reviewService.getMyReviewForProduct(req.customer!.customerId, productId);
  res.json({ review });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.createReview(req.customer!.customerId, req.body);
  res.status(201).json({ review });
});

// --- admin ---

export const listAdmin = asyncHandler(async (req: Request, res: Response) => {
  res.json(await reviewService.listReviewsAdmin(req.query as never));
});

export const moderate = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.moderateReview(req.params.id!, req.body.status);
  res.json({ review });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await reviewService.deleteReview(req.params.id!);
  res.status(204).end();
});
