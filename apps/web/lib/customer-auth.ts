import type {
  Customer,
  CustomerLoginInput,
  CustomerRegisterInput,
  UpdateCustomerInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyEmailInput,
  UnsubscribeEmailInput,
  GoogleLoginInput,
  RequestOtpInput,
  VerifyOtpInput,
} from "@clothing-brand/shared";
import { apiFetch } from "./api-client";

export function registerCustomer(input: CustomerRegisterInput) {
  return apiFetch<{ customer: Customer }>("/api/customers/register", { method: "POST", body: input });
}

export function loginCustomer(input: CustomerLoginInput) {
  return apiFetch<{ customer: Customer }>("/api/customers/login", { method: "POST", body: input });
}

export function logoutCustomer() {
  return apiFetch<void>("/api/customers/logout", { method: "POST" });
}

export function getCurrentCustomer() {
  return apiFetch<{ customer: Customer }>("/api/customers/me");
}

export function updateCustomerProfile(input: UpdateCustomerInput) {
  return apiFetch<{ customer: Customer }>("/api/customers/me", { method: "PATCH", body: input });
}

export function requestPasswordReset(input: ForgotPasswordInput) {
  return apiFetch<{ message: string }>("/api/customers/forgot-password", { method: "POST", body: input });
}

export function resetPassword(input: ResetPasswordInput) {
  return apiFetch<{ message: string }>("/api/customers/reset-password", { method: "POST", body: input });
}

export function verifyEmail(input: VerifyEmailInput) {
  return apiFetch<{ message: string }>("/api/customers/verify-email", { method: "POST", body: input });
}

export function resendVerificationEmail() {
  return apiFetch<{ message: string }>("/api/customers/resend-verification", { method: "POST" });
}

export function unsubscribeFromEmailMarketing(input: UnsubscribeEmailInput) {
  return apiFetch<{ message: string }>("/api/customers/unsubscribe", { method: "POST", body: input });
}

export function loginWithGoogle(input: GoogleLoginInput) {
  return apiFetch<{ customer: Customer }>("/api/customers/google", { method: "POST", body: input });
}

export function requestOtp(input: RequestOtpInput) {
  return apiFetch<{ message: string }>("/api/customers/otp/request", { method: "POST", body: input });
}

export function verifyOtp(input: VerifyOtpInput) {
  return apiFetch<{ customer: Customer }>("/api/customers/otp/verify", { method: "POST", body: input });
}
