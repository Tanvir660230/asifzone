import { Router } from "express";
import { adminLoginSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import { loginRateLimit } from "../../middlewares/rate-limit";
import { login, logout, me, refresh } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/login", loginRateLimit, validate(adminLoginSchema), login);
authRouter.post("/logout", logout);
authRouter.post("/refresh", refresh);
authRouter.get("/me", requireAdmin, me);
