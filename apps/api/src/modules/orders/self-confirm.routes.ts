import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { selfConfirmRateLimit } from "../../middlewares/rate-limit";
import { confirmBySelf, getSelfConfirmView } from "./self-confirm";

/** Public: the customer's own confirm / cancel page from the order-placed SMS. The signed code in the path is the key. */
export const selfConfirmRouter = Router();

const actionSchema = z.object({ action: z.enum(["confirm", "cancel"]) });

selfConfirmRouter.get("/:code", selfConfirmRateLimit, asyncHandler(async (req, res) => {
  res.json({ order: await getSelfConfirmView(String(req.params.code)) });
}));
selfConfirmRouter.post("/:code", selfConfirmRateLimit, validate(actionSchema), asyncHandler(async (req, res) => {
  res.json({ order: await confirmBySelf(String(req.params.code), (req.body as z.infer<typeof actionSchema>).action) });
}));
