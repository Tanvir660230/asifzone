import { Router } from "express";
import {
  createAttributeDefinitionSchema,
  productTypeSchema,
  sizeGuidePresetSchema,
  specGroupSchema,
  templateSchema,
  updateAttributeDefinitionSchema,
  updateProductTypeSchema,
} from "@clothing-brand/shared";
import { z } from "zod";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import * as catalog from "./catalog.service";

export const catalogRouter = Router();

// Every route needs an admin session. Reading is open to STAFF (the product editor loads the type list);
// changing what a product type *is* changes how every product of that type is collected and shown, so
// writes are OWNER-only.
catalogRouter.use(requireAdmin);
const ownerOnly = requireRole("OWNER");

const archiveSchema = z.object({ isArchived: z.boolean() });

/* product types */
catalogRouter.get("/types", asyncHandler(async (req, res) => {
  res.json({ types: await catalog.listResolvedTypes(req.query.includeInactive === "true") });
}));
catalogRouter.get("/types/manage", asyncHandler(async (_req, res) => {
  res.json({ types: await catalog.listTypesForManagement() });
}));
catalogRouter.post("/types", ownerOnly, validate(productTypeSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ type: await catalog.createType(req.body) });
}));
catalogRouter.patch("/types/:id", ownerOnly, validate(updateProductTypeSchema), asyncHandler(async (req, res) => {
  res.json({ type: await catalog.updateType(req.params.id!, req.body) });
}));
catalogRouter.delete("/types/:id", ownerOnly, asyncHandler(async (req, res) => {
  await catalog.deleteType(req.params.id!);
  res.status(204).send();
}));

/* templates */
catalogRouter.get("/templates", asyncHandler(async (_req, res) => {
  res.json({ templates: await catalog.listTemplates() });
}));
catalogRouter.get("/templates/:id", asyncHandler(async (req, res) => {
  res.json({ template: await catalog.getTemplate(req.params.id!) });
}));
catalogRouter.post("/templates", ownerOnly, validate(templateSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ template: await catalog.createTemplate(req.body) });
}));
catalogRouter.patch("/templates/:id", ownerOnly, validate(templateSchema.partial()), asyncHandler(async (req, res) => {
  res.json({ template: await catalog.updateTemplate(req.params.id!, req.body) });
}));
catalogRouter.delete("/templates/:id", ownerOnly, asyncHandler(async (req, res) => {
  await catalog.deleteTemplate(req.params.id!);
  res.status(204).send();
}));

/* attribute definitions */
catalogRouter.get("/attributes", asyncHandler(async (_req, res) => {
  res.json({ attributes: await catalog.listAttributeDefinitions() });
}));
catalogRouter.post("/attributes", ownerOnly, validate(createAttributeDefinitionSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ attribute: await catalog.createAttributeDefinition(req.body) });
}));
catalogRouter.patch("/attributes/:id", ownerOnly, validate(updateAttributeDefinitionSchema), asyncHandler(async (req, res) => {
  res.json({ attribute: await catalog.updateAttributeDefinition(req.params.id!, req.body) });
}));
catalogRouter.delete("/attributes/:id", ownerOnly, asyncHandler(async (req, res) => {
  await catalog.deleteAttributeDefinition(req.params.id!);
  res.status(204).send();
}));

/* spec groups */
catalogRouter.get("/spec-groups", asyncHandler(async (_req, res) => {
  res.json({ specGroups: await catalog.listSpecGroups() });
}));
catalogRouter.post("/spec-groups", ownerOnly, validate(specGroupSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ specGroup: await catalog.createSpecGroup(req.body) });
}));
catalogRouter.patch("/spec-groups/:id", ownerOnly, validate(specGroupSchema.partial()), asyncHandler(async (req, res) => {
  res.json({ specGroup: await catalog.updateSpecGroup(req.params.id!, req.body) });
}));
catalogRouter.delete("/spec-groups/:id", ownerOnly, asyncHandler(async (req, res) => {
  await catalog.deleteSpecGroup(req.params.id!);
  res.status(204).send();
}));

/* size guide presets */
catalogRouter.get("/size-guides", asyncHandler(async (_req, res) => {
  res.json({ sizeGuides: await catalog.listSizeGuidePresets() });
}));
catalogRouter.post("/size-guides", ownerOnly, validate(sizeGuidePresetSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ sizeGuide: await catalog.createSizeGuidePreset(req.body) });
}));
catalogRouter.put("/size-guides/:id", ownerOnly, validate(sizeGuidePresetSchema), asyncHandler(async (req, res) => {
  res.json({ sizeGuide: await catalog.updateSizeGuidePreset(req.params.id!, req.body) });
}));
catalogRouter.post("/size-guides/:id/duplicate", ownerOnly, asyncHandler(async (req, res) => {
  res.status(201).json({ sizeGuide: await catalog.duplicateSizeGuidePreset(req.params.id!) });
}));
catalogRouter.patch("/size-guides/:id/archive", ownerOnly, validate(archiveSchema), asyncHandler(async (req, res) => {
  res.json({ sizeGuide: await catalog.setSizeGuidePresetArchived(req.params.id!, req.body.isArchived) });
}));
catalogRouter.delete("/size-guides/:id", ownerOnly, asyncHandler(async (req, res) => {
  await catalog.deleteSizeGuidePreset(req.params.id!);
  res.status(204).send();
}));
