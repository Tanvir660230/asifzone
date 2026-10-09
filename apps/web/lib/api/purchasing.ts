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

// ── Phase 4E: supplier invoices, credit notes and payables (docs/FINANCE_PHASE_4E.md) ───────────────────────────────────
export type SupplierInvoiceKind = "INVOICE" | "CREDIT_NOTE";
export type SupplierInvoiceStatus = "DRAFT" | "POSTED" | "VOID";
export type SupplierInvoiceLineType = "STOCK" | "RETURN" | "EXPENSE" | "PRODUCTION_COST";
export interface SupplierInvoice {
  id: string;
  number: string;
  kind: SupplierInvoiceKind;
  status: SupplierInvoiceStatus;
  supplier: { id: string; code: string; displayName: string };
  supplierRef: string;
  invoiceDate: string;
  dueDate: string;
  overdue: boolean;
  notes: string | null;
  varianceReason: string | null;
  net: number;
  tax: number;
  total: number;
  settled: number;
  outstanding: number | null;
  postedAt: string | null;
  voidReason: string | null;
  lines: Array<{
    id: string;
    lineNo: number;
    lineType: SupplierInvoiceLineType;
    description: string;
    quantity: number;
    unitPrice: number;
    taxCode: { id: string; code: string } | null;
    net: number;
    tax: number;
    recoverableTax: number;
    cleared: number | null;
    priceDifference: number | null;
    sku: string | null;
    goodsReceipt: { id: string; number: string } | null;
    purchaseReturn: { id: string; number: string } | null;
    productionOrder: { id: string; number: string } | null;
  }>;
}
export interface SupplierOpenItems {
  supplier: { id: string; displayName: string; paymentTermsDays: number; defaultTaxCodeId: string | null };
  goods: Array<{ goodsReceiptLineId: string; goodsReceipt: { id: string; number: string; date: string }; sku: string; name: string; open: number; receiptUnitCost: number; orderedUnitPrice: number | null; taxCodeId: string | null }>;
  returns: Array<{ purchaseReturnLineId: string; purchaseReturn: { id: string; number: string }; sku: string; open: number; returnedUnitValue: number | null }>;
  productionCosts: Array<{ productionCostEntryId: string; productionOrder: { id: string; number: string }; category: string; description: string; reference: string | null; amount: number }>;
  services: Array<{ purchaseOrderLineId: string; purchaseOrder: { id: string; number: string }; description: string; expenseAccountId: string | null; open: number; unitPrice: number; taxCodeId: string | null }>;
}
export interface PayablesAgeing {
  asOf: string;
  suppliers: Array<{ supplier: { id: string; code: string; displayName: string }; invoices: number; current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; credits: number; advances: number; balance: number; overdue: number }>;
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; credits: number; advances: number; balance: number; overdue: number };
}
export const payablesKeys = {
  all: ["purchasing", "payables"] as const,
  invoices: (q: object) => ["purchasing", "payables", "invoices", q] as const,
  openItems: (supplierId: string) => ["purchasing", "payables", "open-items", supplierId] as const,
  ageing: () => ["purchasing", "payables", "ageing"] as const,
};
export const listSupplierInvoices = (q: { status?: string; kind?: string; supplierId?: string; q?: string; pageSize?: number } = {}) =>
  apiFetch<{ total: number; invoices: SupplierInvoice[] }>(`${BASE}/supplier-invoices${qs(q)}`);
export const supplierOpenItems = (supplierId: string) => apiFetch<SupplierOpenItems>(`${BASE}/supplier-invoices/open-items${qs({ supplierId })}`);
export const createSupplierInvoice = (body: Record<string, unknown>) => apiFetch<SupplierInvoice>(`${BASE}/supplier-invoices`, { method: "POST", body });
export const deleteSupplierInvoice = (id: string) => apiFetch<void>(`${BASE}/supplier-invoices/${id}`, { method: "DELETE" });
export const postSupplierInvoice = (id: string, varianceReason?: string | null) =>
  apiFetch<{ invoice: SupplierInvoice; replayed: boolean }>(`${BASE}/supplier-invoices/${id}/post`, { method: "POST", body: varianceReason ? { varianceReason } : {} });
export const voidSupplierInvoice = (id: string, reason: string) => apiFetch<SupplierInvoice>(`${BASE}/supplier-invoices/${id}/void`, { method: "POST", body: { reason } });
export const payablesAgeing = () => apiFetch<PayablesAgeing>(`${BASE}/payables/ageing`);

// ── Phase 4F: supplier payments and allocations (docs/FINANCE_PHASE_4F.md) ───────────────────────────────────────────────
export interface SupplierAccount {
  supplier: { id: string; code: string; displayName: string; paymentTermsDays: number };
  asOf: string;
  opening: number;
  balance: number;
  statement: Array<{ id: string; date: string; description: string; reference: string | null; kind: string; owedMore: number; owedLess: number; balance: number }>;
  openBills: Array<{ id: string; number: string; supplierRef: string; invoiceDate: string; dueDate: string; overdue: boolean; total: number; settled: number; awaitingApproval: number; outstanding: number; allocatable: number }>;
  advances: Array<{ paymentMovementId: string; date: string; reference: string | null; from: string | null; amount: number; unallocated: number }>;
  unappliedCredits: Array<{ creditNoteId: string; number: string; supplierRef: string; date: string; total: number; unallocated: number }>;
}
export const supplierAccountKey = (id: string) => ["purchasing", "payables", "account", id] as const;
export const getSupplierAccount = (id: string) => apiFetch<SupplierAccount>(`${BASE}/suppliers/${id}/account`);
export const paySupplier = (body: { supplierId: string; fromFinancialAccountId: string; movementDate?: string; amount: number; reference?: string | null; allocations: Array<{ invoiceId: string; amount: number }> }, idempotencyKey: string) =>
  apiFetch<{ payment: { id: string; status: "PENDING_APPROVAL" | "POSTED"; amount: number }; replayed: boolean }>(`${BASE}/supplier-payments`, { method: "POST", body, idempotencyKey });
export const allocateToBill = (body: { invoiceId: string; amount: number; paymentMovementId?: string | null; creditNoteId?: string | null }) =>
  apiFetch<{ id: string; amount: number }>(`${BASE}/supplier-allocations`, { method: "POST", body });

// ── Phase 4G: reports (docs/FINANCE_PHASE_4G.md) ───────────────────────────────────────────────────────────────────────
export type ReportId = "purchase-register" | "grni-ageing" | "price-variance" | "inventory-valuation" | "cost-adjustments" | "supplier-payments";
export const getPurchasingReport = (id: ReportId, q: { from?: string; to?: string; q?: string } = {}) => apiFetch<Record<string, unknown>>(`${BASE}/reports/${id}${qs(q)}`);
