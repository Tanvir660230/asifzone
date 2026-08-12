import { z } from "zod";
import { bdPhoneSchema, nullableBdPhone, nullableString, paginationQuerySchema } from "./common";
import { BD_DIVISIONS } from "./order";

export const customerRegisterSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8),
  phone: nullableBdPhone(),
});

export const customerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  // Defaults to today's persistent (7-day) session when omitted — explicitly `false` is the one
  // that changes anything, shortening the session to browser-close rather than the other way round.
  rememberMe: z.boolean().optional(),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

export const requestOtpSchema = z.object({
  phone: bdPhoneSchema(),
});

export const verifyOtpSchema = z.object({
  phone: bdPhoneSchema(),
  code: z.string().length(6),
  // Only required the first time a new phone number verifies — an existing customer's phone
  // logs in without them.
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: nullableBdPhone(),
  smsMarketingOptIn: z.boolean().optional(),
  emailMarketingOptIn: z.boolean().optional(),
});

/** Verifies the one-click unsubscribe link sent in every marketing campaign email — see
 * lib/token-hash.ts's signPayload, used statelessly (no DB-stored token, so it never expires). */
export const unsubscribeEmailSchema = z.object({
  customerId: z.string().min(1),
  token: z.string().min(1),
});

export const addressSchema = z.object({
  label: nullableString(50),
  fullName: z.string().min(1).max(200),
  phone: bdPhoneSchema(),
  division: z.enum(BD_DIVISIONS),
  district: z.string().min(1).max(120),
  area: z.string().min(1).max(120),
  addressLine: z.string().min(1).max(500),
  isDefault: z.boolean().default(false),
});

export const createAddressSchema = addressSchema;
export const updateAddressSchema = addressSchema.partial();

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export const customerTagEnum = z.enum([
  "NEW",
  "REPEAT",
  "VIP",
  "HIGH_SPENDER",
  "INACTIVE",
  "SUSPICIOUS",
  "COD_RISK",
  "BLOCKED",
]);

export const customerListQuerySchema = paginationQuerySchema.extend({
  // Also matches against the customer's order numbers (see listCustomersAdmin) — an admin searching
  // an order ID from a support chat should land on the customer, not have to go via the Orders page.
  search: z.string().min(1).max(200).optional(),
  tag: customerTagEnum.optional(),
  district: z.string().min(1).max(120).optional(),
  noOrders: z.enum(["true", "false"]).optional(),
  // "Last order within N days" — powers the Last 30/90 Days smart filters.
  lastOrderDays: z.coerce.number().int().positive().optional(),
  minSpend: z.coerce.number().nonnegative().optional(),
  minOrders: z.coerce.number().int().nonnegative().optional(),
  // Computed columns (totalSpent/totalOrders/lastOrderAt), not plain Customer columns — sorted
  // in-memory by listCustomersAdmin rather than via Prisma orderBy. Fine at this store's customer
  // volumes; revisit with a raw aggregate query if that stops being true.
  sortBy: z.enum(["name", "createdAt", "totalSpent", "totalOrders", "lastOrderAt"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export const adjustRewardPointsSchema = z.object({
  points: z.number().int().refine((v) => v !== 0, "Point adjustment cannot be zero"),
  reason: z.string().max(200).optional(),
});

export const updateCustomerAdminFieldsSchema = z.object({
  adminNotes: nullableString(2000),
  isBlocked: z.boolean().optional(),
  codRisk: z.boolean().optional(),
});

export const sendAdHocSmsSchema = z.object({
  body: z.string().min(1).max(1000),
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CustomerTag = z.infer<typeof customerTagEnum>;
export type AdjustRewardPointsInput = z.infer<typeof adjustRewardPointsSchema>;
export type UnsubscribeEmailInput = z.infer<typeof unsubscribeEmailSchema>;
export type UpdateCustomerAdminFieldsInput = z.infer<typeof updateCustomerAdminFieldsSchema>;
export type SendAdHocSmsInput = z.infer<typeof sendAdHocSmsSchema>;
