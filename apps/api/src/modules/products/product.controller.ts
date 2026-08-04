import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { processProductImage } from "../uploads/upload.service";
import * as productService from "./product.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await productService.listProducts(req.query as never));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ product: await productService.getProductById(req.params.id!) });
});

export const getBySlug = asyncHandler(async (req: Request, res: Response) => {
  res.json({ product: await productService.getProductBySlug(req.params.slug!) });
});

export const storefrontList = asyncHandler(async (req: Request, res: Response) => {
  res.json(await productService.listStorefrontProducts(req.query as never));
});

export const storefrontFacets = asyncHandler(async (req: Request, res: Response) => {
  res.json(await productService.getStorefrontFacets(req.query as never));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.createProduct(req.body);
  res.status(201).json({ product });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.updateProduct(req.params.id!, req.body);
  res.json({ product });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await productService.deleteProduct(req.params.id!);
  res.status(204).send();
});

export const uploadImages = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw AppError.badRequest("No images provided");

  const processed = await Promise.all(files.map((f) => processProductImage(f.buffer, f.originalname)));
  const product = await productService.addProductImages(req.params.id!, processed);
  res.status(201).json({ product });
});

export const removeImage = asyncHandler(async (req: Request, res: Response) => {
  await productService.deleteProductImage(req.params.id!, req.params.imageId!);
  res.status(204).send();
});
