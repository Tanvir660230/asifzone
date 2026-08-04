import { z } from "zod";
import { nullableString } from "./common";
import { BD_DIVISIONS } from "./order";

export const customerRegisterSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8),
  phone: nullableString(20),
});

export const customerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: nullableString(20),
});

export const addressSchema = z.object({
  label: nullableString(50),
  fullName: z.string().min(1).max(200),
  phone: z.string().min(6).max(20),
  division: z.enum(BD_DIVISIONS),
  district: z.string().min(1).max(120),
  area: z.string().min(1).max(120),
  addressLine: z.string().min(1).max(500),
  isDefault: z.boolean().default(false),
});

export const createAddressSchema = addressSchema;
export const updateAddressSchema = addressSchema.partial();

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
