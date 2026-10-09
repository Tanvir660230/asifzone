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

// ── Phase 4D: purchase orders, goods receipts, supplier returns (docs/FINANCE_PHASE_4D.md) ────────────────────────────
export type PurchaseOrderStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED";
export type GoodsReceiptStatus = "DRAFT" | "POSTED" | "REVERSED";
export type PurchaseReturnStatus = "DRAFT" | "APPROVED" | "SHIPPED" | "CANCELLED";
export interface SupplierRef { id: string; code: string; displayName: string }
export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  lineType: "STOCK" | "NON_STOCK";
  variantId: string | null;
  sku: string | null;
  description: string;
  expenseAccount: { id: string; code: string; name: string } | null;
  qtyOrdered: number;
  unitPrice: number;
  taxCode: { id: string; code: string; rate: string; recoverablePct: string } | null;
  lineTotal: number;
  qtyReceived: number;
  qtyReturned: number;
  qtyOpen: number;
}
export interface PurchaseOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplier: SupplierRef & { status: SupplierStatus };
  orderDate: string;
  expectedDate: string | null;
  deliveryTerms: string | null;
  notes: string | null;
  createdByAdminId: string | null;
  approvedAt: string | null;
  closedReason: string | null;
  total: number;
  lines: PurchaseOrderLine[];
  receipts?: Array<{ id: string; number: string; status: GoodsReceiptStatus; receiptDate: string }>;
}
export interface GoodsReceipt {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  supplier: SupplierRef;
  purchaseOrder: { id: string; number: string; status: PurchaseOrderStatus } | null;
  receiptDate: string;
  supplierRef: string | null;
  direct: boolean;
  directReason: string | null;
  overReceiptReason: string | null;
  reversalReason: string | null;
  total: number;
  lines: Array<{ id: string; lineNo: number; purchaseOrderLineId: string | null; variantId: string; sku: string; name: string; qtyAccepted: number; qtyRejected: number; unitCost: number; value: number }>;
}
export interface PurchaseReturn {
  id: string;
  number: string;
  status: PurchaseReturnStatus;
  supplier: SupplierRef;
  returnDate: string;
  reason: string;
  cancelledReason: string | null;
  total: number | null;
  lines: Array<{ id: string; lineNo: number; variantId: string; sku: string; name: string; quantity: number; goodsReceipt: { id: string; number: string } | null; value: number | null }>;
}
export interface PurchasableVariant { id: string; sku: string; name: string; stock: number }
export interface PurchasingSettings { purchaseApprovalThreshold: number | null; overReceiptTolerancePct: number }

export const purchasingDocKeys = {
  orders: (q: object) => ["purchasing", "orders", q] as const,
  order: (id: string) => ["purchasing", "orders", "detail", id] as const,
  receipts: (q: object) => ["purchasing", "receipts", q] as const,
  returns: (q: object) => ["purchasing", "returns", q] as const,
  variants: (q: string) => ["purchasing", "variants", q] as const,
};

export const purchasingOverview = () => apiFetch<{ readiness: { ready: boolean; missing: string[] }; currency: string; settings: PurchasingSettings; costingActive: boolean }>(`${BASE}/status`);
export const searchVariants = (q: string) => apiFetch<{ variants: PurchasableVariant[] }>(`${BASE}/variants${qs({ q, take: 20 })}`);

export const listPurchaseOrders = (q: { status?: string; supplierId?: string; q?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; purchaseOrders: PurchaseOrder[] }>(`${BASE}/purchase-orders${qs(q)}`);
export const getPurchaseOrder = (id: string) => apiFetch<PurchaseOrder>(`${BASE}/purchase-orders/${id}`);
export const createPurchaseOrder = (body: Record<string, unknown>) => apiFetch<PurchaseOrder>(`${BASE}/purchase-orders`, { method: "POST", body });
export const deletePurchaseOrder = (id: string) => apiFetch<void>(`${BASE}/purchase-orders/${id}`, { method: "DELETE" });
export const purchaseOrderAction = (id: string, action: "submit" | "return-to-draft" | "approve" | "cancel" | "close", reason?: string) =>
  apiFetch<PurchaseOrder>(`${BASE}/purchase-orders/${id}/${action}`, { method: "POST", body: reason ? { reason } : {} });

export const listGoodsReceipts = (q: { status?: string; purchaseOrderId?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; goodsReceipts: GoodsReceipt[] }>(`${BASE}/goods-receipts${qs(q)}`);
export const createGoodsReceipt = (body: Record<string, unknown>) => apiFetch<GoodsReceipt>(`${BASE}/goods-receipts`, { method: "POST", body });
export const deleteGoodsReceipt = (id: string) => apiFetch<void>(`${BASE}/goods-receipts/${id}`, { method: "DELETE" });
export const postGoodsReceipt = (id: string, overReceiptReason?: string | null) =>
  apiFetch<{ receipt: GoodsReceipt; replayed: boolean }>(`${BASE}/goods-receipts/${id}/post`, { method: "POST", body: overReceiptReason ? { overReceiptReason } : {} });
export const reverseGoodsReceipt = (id: string, reason: string) => apiFetch<{ receipt: GoodsReceipt }>(`${BASE}/goods-receipts/${id}/reverse`, { method: "POST", body: { reason } });

export const listPurchaseReturns = (q: { status?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; purchaseReturns: PurchaseReturn[] }>(`${BASE}/returns${qs(q)}`);
export const createPurchaseReturn = (body: Record<string, unknown>) => apiFetch<PurchaseReturn>(`${BASE}/returns`, { method: "POST", body });
export const purchaseReturnAction = (id: string, action: "approve" | "reopen" | "cancel" | "ship", reason?: string) =>
  apiFetch<PurchaseReturn | { purchaseReturn: PurchaseReturn }>(`${BASE}/returns/${id}/${action}`, { method: "POST", body: reason ? { reason } : {} });
export const updatePurchasingSettings = (body: { purchaseApprovalThreshold?: number | null; overReceiptTolerancePct?: number; reason?: string | null }) =>
  apiFetch<PurchasingSettings>(`${BASE}/settings`, { method: "PATCH", body });
