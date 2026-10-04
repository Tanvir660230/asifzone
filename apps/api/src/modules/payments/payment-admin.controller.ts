import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { getPaymentsOverview, searchPaymentAttempts } from "./payments-overview.service";
import { paymentLedgerDrift, repairPaymentLedger } from "../../domain/payments/payment-ledger.service";

export const overview = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getPaymentsOverview());
});

export const search = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.query as { phone: string };
  res.json({ results: await searchPaymentAttempts(phone) });
});

export const ledgerDrift = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await paymentLedgerDrift());
});

export const ledgerRepair = asyncHandler(async (req: Request, res: Response) => {
  res.json(await repairPaymentLedger({ apply: req.body.apply === true }));
});
