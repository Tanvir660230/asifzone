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

export const suggest = asyncHandler(async (req: Request, res: Response) => {
  const { q, limit } = req.query as unknown as { q: string; limit: number };
  res.json(await productService.suggestSearch(q, limit));
});

export const popularSearches = asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.query as unknown as { limit: number };
  res.json({ queries: await productService.getPopularSearches(limit) });
});

export const byIds = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.query as unknown as { ids: string[] };
  res.json({ items: await productService.getProductsByIds(ids) });
});

export const trending = asyncHandler(async (req: Request, res: Response) => {
  const { minPrice, maxPrice, limit } = req.query as unknown as {
    minPrice?: number;
    maxPrice?: number;
    limit: number;
  };
  res.json({ items: await productService.getTrendingProducts({ minPrice, maxPrice, limit }) });
});

export const recommended = asyncHandler(async (req: Request, res: Response) => {
  const { categoryIds, exclude, limit } = req.query as unknown as {
    categoryIds: string[];
    exclude?: string;
    limit: number;
  };
  res.json({ items: await productService.getRecommendedByCategories(categoryIds, { exclude, limit }) });
});

export const similar = asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await productService.getSimilarProducts(req.params.id!) });
});

export const frequentlyBoughtTogether = asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await productService.getFrequentlyBoughtTogether(req.params.id!) });
});

export const completeYourLook = asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await productService.getCompleteYourLook(req.params.id!) });
});

export const budgetAlternatives = asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await productService.getBudgetAlternatives(req.params.id!) });
});

export const upgradeOptions = asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await productService.getUpgradeOptions(req.params.id!) });
});

export const premiumAlternatives = asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await productService.getPremiumAlternatives(req.params.id!) });
});

export const recordView = asyncHandler(async (req: Request, res: Response) => {
  await productService.logProductView(req.params.id!);
  res.status(204).send();
});

export const urgencySignals = asyncHandler(async (req: Request, res: Response) => {
  res.json(await productService.getUrgencySignals(req.params.id!));
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

export const restore = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.restoreProduct(req.params.id!);
  res.json({ product });
});

export const permanentlyRemove = asyncHandler(async (req: Request, res: Response) => {
  await productService.permanentlyDeleteProduct(req.params.id!);
  res.status(204).send();
});

export const bulkDelete = asyncHandler(async (req: Request, res: Response) => {
  await productService.bulkDeleteProducts(req.body.ids);
  res.status(204).send();
});

export const bulkStatus = asyncHandler(async (req: Request, res: Response) => {
  await productService.bulkUpdateProductStatus(req.body.ids, req.body.isActive);
  res.status(204).send();
});

export const bulkCategory = asyncHandler(async (req: Request, res: Response) => {
  await productService.bulkUpdateProductCategory(req.body.ids, req.body.categoryId);
  res.status(204).send();
});

export const exportCsv = asyncHandler(async (_req: Request, res: Response) => {
  const csv = await productService.exportProductsCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="products-${Date.now()}.csv"`);
  res.send(csv);
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

export const updateImageAltText = asyncHandler(async (req: Request, res: Response) => {
  await productService.updateProductImageAltText(req.params.id!, req.params.imageId!, req.body.altText);
  res.status(204).send();
});
