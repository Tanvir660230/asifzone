import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requireAdmin } from "../../middlewares/require-admin";
import { imageUpload } from "./upload.middleware";
import { processEditorImage } from "./upload.service";

export const uploadRouter = Router();

uploadRouter.post(
  "/editor-image",
  requireAdmin,
  imageUpload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }
    const url = await processEditorImage(req.file.buffer);
    res.status(201).json({ url });
  }),
);
