import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as attributeService from "./attribute.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ attributes: await attributeService.listAttributes() });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ attribute: await attributeService.getAttributeById(req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const attribute = await attributeService.createAttribute(req.body);
  res.status(201).json({ attribute });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const attribute = await attributeService.updateAttribute(req.params.id!, req.body);
  res.json({ attribute });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await attributeService.deleteAttribute(req.params.id!);
  res.status(204).send();
});
