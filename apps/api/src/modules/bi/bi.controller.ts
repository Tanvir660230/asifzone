import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as biService from "./bi.service";

export const overview = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await biService.getExecutiveOverview());
});

export const automatedInsights = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ insights: await biService.getAutomatedInsights() });
});
