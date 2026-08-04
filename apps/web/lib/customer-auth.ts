import type { Customer, CustomerLoginInput, CustomerRegisterInput, UpdateCustomerInput } from "@clothing-brand/shared";
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
