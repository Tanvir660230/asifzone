/**
 * Purchasing admin API (/api/v1/purchasing — docs/FINANCE_PHASE_4.md). 4A: set-up status, suppliers and purchase tax
 * codes. Money in major units; tax rates are decimal strings.
 */
import { apiFetch } from "../api-client";

const BASE = "/api/v1/purchasing";
const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

export type SupplierStatus = "ACTIVE" | "ON_HOLD" | "INACTIVE";
export interface SupplierAddress {
  line?: string | null;
  area?: string | null;
  district?: string | null;
  division?: string | null;
  postalCode?: string | null;
  country?: string | null;
}
export interface Supplier {
  id: string;
  code: string;
  legalName: string;
  displayName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: SupplierAddress | null;
  taxId: string | null;
  vatRegistrationNo: string | null;
  currency: string;
  paymentTermsDays: number;
  paymentTermsNote: string | null;
  creditLimit: number | null;
  defaultTaxCodeId: string | null;
  defaultExpenseAccountId: string | null;
  status: SupplierStatus;
  statusReason: string | null;
  notes: string | null;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface TaxCode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rate: string;
  recoverablePct: string;
  recoverableMappingKey: string;
  nonRecoverableMappingKey: string;
  isActive: boolean;
}

export const purchasingKeys = {
  all: ["purchasing"] as const,
  suppliers: (q: object) => ["purchasing", "suppliers", q] as const,
  taxCodes: () => ["purchasing", "tax-codes"] as const,
  status: () => ["purchasing", "status"] as const,
};

export const purchasingStatus = () => apiFetch<{ readiness: { ready: boolean; missing: string[] }; currency: string }>(`${BASE}/status`);
export const setupPurchasing = () => apiFetch<{ changes: string[]; missing: string[] }>(`${BASE}/setup`, { method: "POST", body: {} });

export const listSuppliers = (q: { q?: string; status?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; suppliers: Supplier[] }>(`${BASE}/suppliers${qs(q)}`);
export const getSupplier = (id: string) => apiFetch<Supplier>(`${BASE}/suppliers/${id}`);
export const createSupplier = (body: Record<string, unknown>) => apiFetch<Supplier>(`${BASE}/suppliers`, { method: "POST", body });
export const updateSupplier = (id: string, body: Record<string, unknown>) => apiFetch<Supplier>(`${BASE}/suppliers/${id}`, { method: "PATCH", body });
export const setSupplierStatus = (id: string, status: SupplierStatus, reason: string | null) =>
  apiFetch<Supplier>(`${BASE}/suppliers/${id}/status`, { method: "POST", body: { status, reason } });

export const listTaxCodes = (activeOnly = false) => apiFetch<{ taxCodes: TaxCode[] }>(`${BASE}/tax-codes${activeOnly ? "?activeOnly=true" : ""}`);
export const createTaxCode = (body: Record<string, unknown>) => apiFetch<TaxCode>(`${BASE}/tax-codes`, { method: "POST", body });
export const updateTaxCode = (id: string, body: { name?: string; description?: string | null; isActive?: boolean }) =>
  apiFetch<TaxCode>(`${BASE}/tax-codes/${id}`, { method: "PATCH", body });
