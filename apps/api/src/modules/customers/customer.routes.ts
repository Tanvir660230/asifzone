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
  verifyEmailSchema,
  unsubscribeEmailSchema,
  googleLoginSchema,
  requestOtpSchema,
  verifyOtpSchema,
  customerListQuerySchema,
  adjustRewardPointsSchema,
  pushSubscribeSchema,
  pushUnsubscribeQuerySchema,
  updateCustomerAdminFieldsSchema,
  sendAdHocSmsSchema,
  bulkSendSmsSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import { requireAdmin } from "../../middlewares/require-admin";
import { loginRateLimit, otpRequestRateLimit } from "../../middlewares/rate-limit";
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
customerRouter.post("/verify-email", loginRateLimit, validate(verifyEmailSchema), customerController.verifyEmail);
customerRouter.post("/resend-verification", requireCustomer, customerController.resendVerification);
// Public — clicked from a marketing email, no session required. Its own HMAC token (not the CSRF
// cookie) is what proves the caller holds a real unsubscribe link (see generateEmailUnsubscribeToken).
customerRouter.post(
  "/unsubscribe",
  loginRateLimit,
  validate(unsubscribeEmailSchema),
  customerController.unsubscribeEmail,
);

customerRouter.post("/google", loginRateLimit, validate(googleLoginSchema), customerController.googleLogin);
customerRouter.post("/otp/request", otpRequestRateLimit, validate(requestOtpSchema), customerController.requestOtp);
customerRouter.post("/otp/verify", loginRateLimit, validate(verifyOtpSchema), customerController.verifyOtp);

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
customerRouter.get("/me/orders/:id", requireCustomer, customerController.getOrder);

customerRouter.get(
  "/me/points",
  requireCustomer,
  validate(paginationQuerySchema, "query"),
  customerController.listPoints,
);

customerRouter.get("/me/push-subscriptions", requireCustomer, customerController.listMyPushSubscriptions);
customerRouter.post(
  "/me/push-subscriptions",
  requireCustomer,
  validate(pushSubscribeSchema),
  customerController.subscribePush,
);
customerRouter.delete(
  "/me/push-subscriptions",
  requireCustomer,
  validate(pushUnsubscribeQuerySchema, "query"),
  customerController.unsubscribePush,
);

customerRouter.get(
  "/admin",
  requireAdmin,
  validate(customerListQuerySchema, "query"),
  customerController.listCustomersAdmin,
);
// Must come before "/admin/:id" — otherwise Express matches "stats" as the :id param.
customerRouter.get("/admin/stats", requireAdmin, customerController.getCustomerStatsAdmin);
// Same reason: "/admin/:id/sms" below would otherwise match "/admin/bulk/sms" with id="bulk".
customerRouter.post(
  "/admin/bulk/sms",
  requireAdmin,
  validate(bulkSendSmsSchema),
  customerController.sendBulkSms,
);
customerRouter.get("/admin/:id", requireAdmin, customerController.getCustomerDetailAdmin);
customerRouter.post(
  "/admin/:id/points",
  requireAdmin,
  validate(adjustRewardPointsSchema),
  customerController.adjustPoints,
);
customerRouter.patch(
  "/admin/:id",
  requireAdmin,
  validate(updateCustomerAdminFieldsSchema),
  customerController.updateCustomerAdminFields,
);
customerRouter.post(
  "/admin/:id/sms",
  requireAdmin,
  validate(sendAdHocSmsSchema),
  customerController.sendAdHocSms,
);
