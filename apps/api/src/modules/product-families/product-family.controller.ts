import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as service from "./product-family.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ families: await service.listProductFamilies() });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ family: await service.getProductFamily(req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  res.status(201).json({ family: await service.createProductFamily(req.body, req.admin!.adminId, req.ip) });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  res.json({ family: await service.updateProductFamily(req.params.id!, req.body, req.admin!.adminId, req.ip) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  await service.deleteProductFamily(req.params.id!, req.admin!.adminId, req.ip);
  res.status(204).end();
});

/** Public: the families a product page shows. A minute of caching — a family edit shows up within a minute. */
export const forProduct = asyncHandler(async (req: Request, res: Response) => {
  res.set("Cache-Control", "public, max-age=60");
  res.json({ families: await service.familiesForProduct(req.params.productId!) });
});
