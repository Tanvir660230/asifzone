import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as feedbackService from "./feedback.service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  await feedbackService.createFeedback(req.body);
  res.status(201).json({ submitted: true });
});

// --- admin ---

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await feedbackService.listFeedback(req.query as never));
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const feedback = await feedbackService.markFeedbackRead(req.params.id!);
  res.json({ feedback });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await feedbackService.deleteFeedback(req.params.id!);
  res.status(204).end();
});
