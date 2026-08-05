import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as redirectService from "./redirect.service";

export const active = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ redirects: await redirectService.listActiveRedirects() });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await redirectService.listRedirects(req.query as never));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ redirect: await redirectService.getRedirectById(req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const redirect = await redirectService.createRedirect(req.body);
  res.status(201).json({ redirect });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json({ redirect: await redirectService.updateRedirect(req.params.id!, req.body) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await redirectService.deleteRedirect(req.params.id!);
  res.status(204).send();
});
