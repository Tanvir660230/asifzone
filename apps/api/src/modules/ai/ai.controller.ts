import type { Request, Response } from "express";
import type { GenerateAiContentInput, GenerateImageAltTextInput } from "@clothing-brand/shared";
import { asyncHandler } from "../../lib/async-handler";
import * as aiService from "./ai.service";

export const status = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ configured: aiService.isAiConfigured() });
});

export const generate = asyncHandler(async (req: Request, res: Response) => {
  const text = await aiService.generateContent(req.body as GenerateAiContentInput);
  res.json({ text });
});

export const generateImageAlt = asyncHandler(async (req: Request, res: Response) => {
  const { imageUrl } = req.body as GenerateImageAltTextInput;
  const text = await aiService.generateImageAltText(imageUrl);
  res.json({ text });
});
