import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { can } from "../../domain/auth/authorization";
import * as confirmation from "./confirmation.service";

/** Customer confirmation calls (Order Operations phase 3) — see confirmation.service.ts. */

export const state = asyncHandler(async (req: Request, res: Response) => {
  res.json(await confirmation.getConfirmationState(req.params.id!));
});

export const recordAttempt = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await confirmation.recordConfirmationAttempt(req.params.id!, req.admin!.adminId, req.body, { canCancel: can(req.admin, "orders.cancel") }));
});

export const next = asyncHandler(async (req: Request, res: Response) => {
  res.json({ next: await confirmation.claimNextConfirmation(req.admin!.adminId) });
});

export const release = asyncHandler(async (req: Request, res: Response) => {
  res.json(await confirmation.releaseConfirmationClaim(req.params.id!, req.admin!.adminId));
});

export const decide = asyncHandler(async (req: Request, res: Response) => {
  res.json(await confirmation.decideConfirmation(req.params.id!, req.admin!.adminId, req.body, { canDecideEscalations: can(req.admin, "orders.escalations") }));
});
