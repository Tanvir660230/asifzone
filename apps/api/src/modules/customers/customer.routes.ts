import { Router } from "express";
import {
  customerRegisterSchema,
  customerLoginSchema,
  updateCustomerSchema,
  createAddressSchema,
  updateAddressSchema,
  paginationQuerySchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  customerListQuerySchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import { requireAdmin } from "../../middlewares/require-admin";
import { loginRateLimit } from "../../middlewares/rate-limit";
import * as customerController from "./customer.controller";

export const customerRouter = Router();

customerRouter.post("/register", loginRateLimit, validate(customerRegisterSchema), customerController.register);
customerRouter.post("/login", loginRateLimit, validate(customerLoginSchema), customerController.login);
customerRouter.post("/logout", customerController.logout);
customerRouter.post("/refresh", customerController.refresh);
customerRouter.post(
  "/forgot-password",
  loginRateLimit,
  validate(forgotPasswordSchema),
  customerController.forgotPassword,
);
customerRouter.post(
  "/reset-password",
  loginRateLimit,
  validate(resetPasswordSchema),
  customerController.resetPassword,
);

customerRouter.get("/me", requireCustomer, customerController.me);
customerRouter.patch("/me", requireCustomer, validate(updateCustomerSchema), customerController.updateMe);

customerRouter.get("/me/addresses", requireCustomer, customerController.listAddresses);
customerRouter.post(
  "/me/addresses",
  requireCustomer,
  validate(createAddressSchema),
  customerController.createAddress,
);
customerRouter.patch(
  "/me/addresses/:id",
  requireCustomer,
  validate(updateAddressSchema),
  customerController.updateAddress,
);
customerRouter.delete("/me/addresses/:id", requireCustomer, customerController.deleteAddress);

customerRouter.get(
  "/me/orders",
  requireCustomer,
  validate(paginationQuerySchema, "query"),
  customerController.listOrders,
);

customerRouter.get(
  "/admin",
  requireAdmin,
  validate(customerListQuerySchema, "query"),
  customerController.listCustomersAdmin,
);
customerRouter.get("/admin/:id", requireAdmin, customerController.getCustomerDetailAdmin);
