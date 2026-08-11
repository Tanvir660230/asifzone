import { Router } from "express";
import { createRedirectSchema, updateRedirectSchema, redirectListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import * as redirectController from "./redirect.controller";

export const redirectRouter = Router();

redirectRouter.get("/active", redirectController.active);

redirectRouter.get("/", requireAdmin, validate(redirectListQuerySchema, "query"), redirectController.list);
redirectRouter.get("/:id", requireAdmin, redirectController.getOne);
// OWNER-only, same reasoning as settings.routes.ts/social-link.routes.ts: a redirect controls
// where a public URL sends visitors, so a STAFF-created redirect is effectively as sensitive as
// editing storefront branding — and a malicious `toPath` from a compromised STAFF session would
// otherwise be an open redirect with no extra gate to catch it.
redirectRouter.post("/", requireAdmin, requireRole("OWNER"), validate(createRedirectSchema), redirectController.create);
redirectRouter.patch(
  "/:id",
  requireAdmin,
  requireRole("OWNER"),
  validate(updateRedirectSchema),
  redirectController.update,
);
redirectRouter.delete("/:id", requireAdmin, requireRole("OWNER"), redirectController.remove);
