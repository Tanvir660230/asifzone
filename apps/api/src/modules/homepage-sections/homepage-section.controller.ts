import type { Request, Response } from "express";
import type {
  CreateHomepageSectionInput,
  PublishStudioDraftInput,
  ReorderHomepageSectionsInput,
  SaveStudioDraftInput,
  UpdateHomepageSectionInput,
} from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import { processHomepageImage } from "../uploads/upload.service";
import * as homepageSectionService from "./homepage-section.service";
import * as homepageStudioService from "./homepage-studio.service";

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

/* ── Storefront Studio ── */

export const studio = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await homepageStudioService.getStudio());
});

export const saveStudioDraft = asyncHandler(async (req: Request, res: Response) => {
  res.json(await homepageStudioService.saveDraft(req.body as SaveStudioDraftInput, req.admin!.adminId));
});

export const discardStudioDraft = asyncHandler(async (req: Request, res: Response) => {
  await homepageStudioService.discardDraft(req.admin!.adminId);
  res.status(204).send();
});

export const publishStudioDraft = asyncHandler(async (req: Request, res: Response) => {
  const { version } = req.body as PublishStudioDraftInput;
  res.json({ sections: await homepageStudioService.publishDraft(version, req.admin!.adminId) });
});

export const studioRevisions = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ revisions: await homepageStudioService.listRevisions() });
});

export const restoreStudioRevision = asyncHandler(async (req: Request, res: Response) => {
  res.json(await homepageStudioService.restoreRevision(req.params.id!, req.admin!.adminId));
});
