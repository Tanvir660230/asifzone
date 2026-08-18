import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { getPaymentsOverview } from "./payments-overview.service";

export const overview = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getPaymentsOverview());
});
