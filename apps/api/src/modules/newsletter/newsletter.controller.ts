import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as newsletterService from "./newsletter.service";

export const subscribe = asyncHandler(async (req: Request, res: Response) => {
  await newsletterService.subscribe(req.body);
  res.status(201).json({ subscribed: true });
});
