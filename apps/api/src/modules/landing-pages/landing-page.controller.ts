import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { processHomepageImage } from "../uploads/upload.service";
import * as service from "./landing-page.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ pages: await service.listLandingPages() });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ page: await service.getLandingPage(req.params.id!) });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  res.status(201).json({ page: await service.createLandingPage(req.body, req.admin!.adminId, req.ip) });
});

export const save = asyncHandler(async (req: Request, res: Response) => {
  res.json({ page: await service.saveLandingPage(req.params.id!, req.body, req.admin!.adminId) });
});

export const publish = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  res.json({ page: await service.publishLandingPage(req.params.id!, req.admin!.adminId, req.ip) });
});

export const unpublish = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  res.json({ page: await service.unpublishLandingPage(req.params.id!, req.admin!.adminId, req.ip) });
});

export const duplicate = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  res.status(201).json({ page: await service.duplicateLandingPage(req.params.id!, req.body, req.admin!.adminId, req.ip) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  await service.deleteLandingPage(req.params.id!, req.admin!.adminId, req.ip);
  res.status(204).end();
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  res.json({ page: await service.getPreviewLandingPage(req.params.id!) });
});

/** Public: the live page at an address. 404 tells the storefront to fall back to the product's own landing page. */
export const publicBySlug = asyncHandler(async (req: Request, res: Response) => {
  const page = await service.getPublicLandingPage(req.params.slug!);
  if (!page) {
    res.status(404).json({ error: "Landing page not found" });
    return;
  }
  res.json({ page });
});

export const uploadImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  res.status(201).json({ url: await processHomepageImage(req.file.buffer) });
});
