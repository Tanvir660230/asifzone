import type { Request, Response } from "express";
import type { CreateHomepageSectionInput, ReorderHomepageSectionsInput, UpdateHomepageSectionInput } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { processHomepageImage } from "../uploads/upload.service";
import * as homepageSectionService from "./homepage-section.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ sections: await homepageSectionService.listHomepageSections() });
});

export const active = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ sections: await homepageSectionService.getActiveHomepageSections() });
});

export const uploadImage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const url = await processHomepageImage(req.file.buffer);
  res.status(201).json({ url });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const section = await homepageSectionService.createHomepageSection(req.body as CreateHomepageSectionInput);
  res.status(201).json({ section });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const section = await homepageSectionService.updateHomepageSection(
    req.params.id!,
    req.body as UpdateHomepageSectionInput,
  );
  res.json({ section });
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as ReorderHomepageSectionsInput;
  res.json({ sections: await homepageSectionService.reorderHomepageSections(ids) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await homepageSectionService.deleteHomepageSection(req.params.id!);
  res.status(204).send();
});
