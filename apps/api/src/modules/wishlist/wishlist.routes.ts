import { Router } from "express";
import { addWishlistItemSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import * as wishlistController from "./wishlist.controller";

export const wishlistRouter = Router();

wishlistRouter.use(requireCustomer);
wishlistRouter.get("/", wishlistController.list);
wishlistRouter.post("/", validate(addWishlistItemSchema), wishlistController.add);
wishlistRouter.delete("/:productId", wishlistController.remove);
