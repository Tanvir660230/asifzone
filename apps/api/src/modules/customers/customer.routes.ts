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
  createCustomerAdminSchema,
  sendAdHocSmsSchema,
  bulkSendSmsSchema,
  phoneVerificationRequestSchema,
  phoneVerificationConfirmSchema,
  changeCustomerPasswordSchema,
  confirmCustomerClaimSchema,
  orderModificationSchema,
  cancelOwnOrderSchema,
  startPaymentLinkSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { emailSendRateLimit, loginRateLimit, orderSelfServiceRateLimit, otpRequestRateLimit, refreshRateLimit } from "../../middlewares/rate-limit";
import * as adjustments from "../orders/order-adjustments.controller";
import * as customerController from "./customer.controller";

export const customerRouter = Router();

customerRouter.post("/register", loginRateLimit, validate(customerRegisterSchema), customerController.register);
customerRouter.post("/login", loginRateLimit, validate(customerLoginSchema), customerController.login);
customerRouter.post("/logout", customerController.logout);
customerRouter.post("/refresh", refreshRateLimit, customerController.refresh);
// Phase 11 (BD-11.6 a): the emailed claim link proves ownership of an existing record's email.
customerRouter.post("/claim/confirm", loginRateLimit, validate(confirmCustomerClaimSchema), customerController.confirmClaim);
customerRouter.post("/logout-all", requireCustomer, loginRateLimit, customerController.logoutAll);
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
customerRouter.post("/resend-verification", requireCustomer, emailSendRateLimit, customerController.resendVerification);
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
// Phase 11 (BD-11.1, BD-11.3): verify a phone (first time, or a new login phone) and set/change the password.
customerRouter.post("/me/phone/otp", requireCustomer, otpRequestRateLimit, validate(phoneVerificationRequestSchema), customerController.requestPhoneVerification);
customerRouter.post("/me/phone/verify", requireCustomer, loginRateLimit, validate(phoneVerificationConfirmSchema), customerController.confirmPhoneVerification);
customerRouter.post("/me/password", requireCustomer, loginRateLimit, validate(changeCustomerPasswordSchema), customerController.changePassword);

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
// Self-service order changes and store balance (docs/ORDER_ADJUSTMENTS.md §2, §5, §18) — own orders only.
customerRouter.get("/me/store-credit", requireCustomer, adjustments.myStoreCredit);
customerRouter.get("/me/orders/:id/modifications", requireCustomer, adjustments.myListModifications);
customerRouter.post("/me/orders/:id/modifications/preview", requireCustomer, orderSelfServiceRateLimit, validate(orderModificationSchema), adjustments.myPreviewModification);
customerRouter.post("/me/orders/:id/modifications", requireCustomer, orderSelfServiceRateLimit, validate(orderModificationSchema), adjustments.myApplyModification);
customerRouter.post("/me/orders/:id/modifications/:modId/pay", requireCustomer, orderSelfServiceRateLimit, validate(startPaymentLinkSchema), adjustments.myPayModification);
customerRouter.post("/me/orders/:id/cancel", requireCustomer, orderSelfServiceRateLimit, validate(cancelOwnOrderSchema), adjustments.myCancelOrder);

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
  requirePermission("customers.read"),
  validate(customerListQuerySchema, "query"),
  customerController.listCustomersAdmin,
);
customerRouter.post(
  "/admin",
  requireAdmin,
  requirePermission("customers.manage"),
  validate(createCustomerAdminSchema),
  customerController.createCustomerAdmin,
);
// Must come before "/admin/:id" — otherwise Express matches "stats" as the :id param.
customerRouter.get("/admin/stats", requireAdmin, requirePermission("customers.read"), customerController.getCustomerStatsAdmin);
// Same reason: "/admin/:id/sms" below would otherwise match "/admin/bulk/sms" with id="bulk".
customerRouter.post(
  "/admin/bulk/sms",
  requireAdmin,
  requirePermission("customers.message"),
  validate(bulkSendSmsSchema),
  customerController.sendBulkSms,
);
customerRouter.get("/admin/:id", requireAdmin, requirePermission("customers.read"), customerController.getCustomerDetailAdmin);
customerRouter.get("/admin/:id/store-credit", requireAdmin, requirePermission("customers.read"), adjustments.adminCustomerStoreCredit);
customerRouter.post(
  "/admin/:id/points",
  requireAdmin,
  requirePermission("loyalty.adjust"),
  validate(adjustRewardPointsSchema),
  customerController.adjustPoints,
);
customerRouter.patch(
  "/admin/:id",
  requireAdmin,
  requirePermission("customers.manage"),
  validate(updateCustomerAdminFieldsSchema),
  customerController.updateCustomerAdminFields,
);
customerRouter.post(
  "/admin/:id/sms",
  requireAdmin,
  requirePermission("customers.message"),
  validate(sendAdHocSmsSchema),
  customerController.sendAdHocSms,
);
