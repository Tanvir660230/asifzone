import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import { processProductImage } from "../uploads/upload.service";
import * as productService from "./product.service";
import { duplicateProduct } from "./product-duplicate";
import { exportProductsFullCsv, importTemplateCsv, planProductImport, runProductImport } from "./product-csv";

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
  // The service records its own, more specific audit events (price changed, published, ...).
  res.locals.auditHandled = true;
  const product = await productService.createProduct(req.body, req.admin!.adminId, req.ip);
  res.status(201).json({ product });
});

export const duplicate = asyncHandler(async (req: Request, res: Response) => {
  // duplicateProduct records its own events (on the copy and on the original).
  res.locals.auditHandled = true;
  const result = await duplicateProduct(req.params.id!, req.body, req.admin!.adminId, req.ip);
  res.status(201).json(result);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  const product = await productService.updateProduct(req.params.id!, req.body, req.admin!.adminId, req.ip);
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
  res.locals.auditHandled = true;
  // `status` is the real field; `isActive` is the legacy boolean (true = publish, false = unpublish).
  const target = req.body.status ?? (req.body.isActive ? "PUBLISHED" : "UNPUBLISHED");
  res.json(await productService.bulkUpdateProductStatus(req.body.ids, target, req.admin!.adminId, req.ip));
});

export const history = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  res.json(await productService.getProductHistory(req.params.id!, page));
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

/** A UTF-8 byte-order mark so Excel reads Bengali and other non-ASCII text correctly instead of guessing a legacy code page. */
function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\ufeff${csv}`);
}

const typeIdOf = (req: Request) => (typeof req.query.typeId === "string" && req.query.typeId ? req.query.typeId : undefined);

export const exportFull = asyncHandler(async (req: Request, res: Response) => {
  sendCsv(res, `products-full-${Date.now()}.csv`, await exportProductsFullCsv(typeIdOf(req)));
});

export const importTemplate = asyncHandler(async (req: Request, res: Response) => {
  sendCsv(res, "products-import-template.csv", await importTemplateCsv(typeIdOf(req)));
});

/** Checks a CSV without writing anything. */
export const importValidate = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  const { report } = await planProductImport(req.body.csv);
  res.json({ report });
});

/** Writes it. Any error stops the import (422 with the report) unless `skipInvalid` says to leave the bad products out. */
export const importCommit = asyncHandler(async (req: Request, res: Response) => {
  res.locals.auditHandled = true;
  const { report, result } = await runProductImport(req.body.csv, { skipInvalid: req.body.skipInvalid }, req.admin!.adminId, req.ip);
  if (!result) return void res.status(422).json({ error: "The file has errors, so nothing was imported.", details: { report } });
  res.json({ report, result });
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

export const updateImage = asyncHandler(async (req: Request, res: Response) => {
  await productService.updateProductImage(req.params.id!, req.params.imageId!, req.body);
  res.status(204).send();
});

export const reorderImages = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.reorderProductImages(req.params.id!, req.body.imageIds);
  res.json({ product });
});

export const rail = asyncHandler(async (req: Request, res: Response) => {
  const key = req.params.key!;
  if (!productService.isRailKey(key)) throw AppError.notFound("Unknown list");
  res.json(await productService.getRail(req.params.id!, key));
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  res.json({ product: await productService.getProductForPreview(req.params.id!) });
});
