import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { processCategoryImage, processCategoryBannerImage } from "../uploads/upload.service";
import * as categoryService from "./category.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ categories: await categoryService.listCategories(req.query as never) });
});

export const tree = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ tree: await categoryService.getCategoryTree() });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ category: await categoryService.getCategoryById(req.params.id!) });
});

export const getBySlug = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.getCategoryBySlug(req.params.slug!);
  const breadcrumb = await categoryService.getCategoryBreadcrumb(category);
  res.json({ category, breadcrumb });
});

export const uploadImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processCategoryImage(req.file.buffer);
  res.status(201).json({ url });
});

export const uploadBannerImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processCategoryBannerImage(req.file.buffer);
  res.status(201).json({ url });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.createCategory(req.body);
  res.status(201).json({ category });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.updateCategory(req.params.id!, req.body);
  res.json({ category });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await categoryService.deleteCategory(req.params.id!);
  res.status(204).send();
});

export const restore = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.restoreCategory(req.params.id!);
  res.json({ category });
});

export const permanentlyRemove = asyncHandler(async (req: Request, res: Response) => {
  await categoryService.permanentlyDeleteCategory(req.params.id!);
  res.status(204).send();
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  await categoryService.reorderCategories(req.body);
  res.status(204).send();
});

export const move = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.moveCategory(req.params.id!, req.body);
  res.json({ category });
});
