import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as feedbackService from "./feedback.service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  await feedbackService.createFeedback(req.body);
  res.status(201).json({ submitted: true });
});
