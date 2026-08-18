import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { getPaymentsOverview, searchPaymentAttempts } from "./payments-overview.service";

export const overview = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getPaymentsOverview());
});

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.query as { phone: string };
  res.json({ results: await searchPaymentAttempts(phone) });
});
