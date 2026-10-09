/**
 * Manufacturing admin API (/api/v1/manufacturing — docs/MANUFACTURING.md). Material quantities are whole stock units;
 * quantities per finished unit are decimal strings; money in major units. Costs come back null without costing.read.
 */
import { apiFetch } from "../api-client";

const BASE = "/api/v1/manufacturing";
const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

export type ProductionOrderStatus = "DRAFT" | "APPROVED" | "IN_PRODUCTION" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED";
export type BomStatus = "DRAFT" | "APPROVED" | "ARCHIVED";
export type MaterialSupplier = "BUSINESS" | "PRODUCER";
export type CostGroup = "MATERIAL" | "LABOUR" | "EXTERNAL_SERVICE" | "OVERHEAD" | "OTHER";

export interface Material {
  id: string;
  name: string;
  stockUnit: string | null;
  description: string;
  referenceCost: number | null;
  archived: boolean;
  variants: Array<{ id: string; sku: string; spec: string; color: string; stock: number; averageCost: number | null; value: number | null }>;
}
export interface BomLine {
  id: string;
  lineNo: number;
  material: { variantId: string; sku: string; name: string; stockUnit: string; isMaterial: boolean };
  finishedVariant: { id: string; sku: string; label: string } | null;
  qtyPerUnit: string;
  wastagePct: string;
  suppliedBy: MaterialSupplier;
  notes: string | null;
}
export interface Bom {
  id: string;
  product: { id: string; name: string };
  version: number;
  status: BomStatus;
  name: string | null;
  notes: string | null;
  approvedAt: string | null;
  lines: BomLine[];
}
export interface CostCategory { id: string; code: string; name: string; group: CostGroup; isActive: boolean; sortOrder: number }
export interface ProductionMaterial {
  id: string;
  lineNo: number;
  materialVariantId: string;
  sku: string;
  name: string;
  stockUnit: string;
  suppliedBy: MaterialSupplier;
  fromBom: boolean;
  qtyPerUnit: string | null;
  wastagePct: string | null;
  plannedQty: number;
  inStock: number;
  shortfall: number;
  plannedUnitCost: number | null;
  plannedCost: number | null;
  issuedQty: number;
  returnedQty: number;
  consumedQty: number;
  scrappedQty: number;
  atProducer: number;
  issuedValue: number | null;
  returnedValue: number | null;
}
export interface ProductionOrder {
  id: string;
  number: string;
  status: ProductionOrderStatus;
  product: { id: string; name: string };
  producer: { id: string; code: string; displayName: string; status: string } | null;
  inHouse: boolean;
  bom: { id: string; version: number; status: BomStatus } | null;
  orderDate: string;
  expectedDate: string | null;
  terms: string | null;
  notes: string | null;
  approvedAt: string | null;
  cancelledReason: string | null;
  closedReason: string | null;
  plannedUnits: number;
  lines: Array<{ id: string; lineNo: number; variantId: string; sku: string; size: string; color: string; plannedQty: number }>;
  materials: ProductionMaterial[];
  plannedCosts: Array<{ id: string; category: { id: string; code: string; name: string; group: CostGroup }; amount: number | null; basis: string | null }>;
  planned: { materialCost: number; materialsWithoutCost: number; otherCost: number; totalCost: number; costPerUnit: number | null } | null;
  wip: { materials: number } | null;
  replayed?: boolean;
}
export interface MaterialMove { id: string; kind: "ISSUE" | "RETURN"; quantity: number; value: number; valuationStatus: string; sku: string; name: string; stockUnit: string | null; overIssueReason: string | null; note: string | null; createdAt: string }
export interface ProducibleProduct { id: string; name: string; variants: Array<{ id: string; sku: string; size: string; color: string; stock: number }> }

export const manufacturingKeys = {
  all: ["manufacturing"] as const,
  status: () => ["manufacturing", "status"] as const,
  orders: (q: object) => ["manufacturing", "orders", q] as const,
  order: (id: string) => ["manufacturing", "orders", "detail", id] as const,
  moves: (id: string) => ["manufacturing", "orders", "moves", id] as const,
  boms: (q: object) => ["manufacturing", "boms", q] as const,
  materials: (q: object) => ["manufacturing", "materials", q] as const,
  categories: () => ["manufacturing", "cost-categories"] as const,
  products: (q: string) => ["manufacturing", "products", q] as const,
};

export const manufacturingStatus = () => apiFetch<{ readiness: { ready: boolean; missing: string[] }; costCategories: number; currency: string; costingActive: boolean }>(`${BASE}/status`);
export const setupManufacturing = () => apiFetch<{ changes: string[]; missing: string[] }>(`${BASE}/setup`, { method: "POST", body: {} });
export const searchProducts = (q: string) => apiFetch<{ products: ProducibleProduct[] }>(`${BASE}/products${qs({ q, take: 20 })}`);

export const listCostCategories = (activeOnly = false) => apiFetch<{ categories: CostCategory[] }>(`${BASE}/cost-categories${activeOnly ? "?activeOnly=true" : ""}`);
export const createCostCategory = (body: { code: string; name: string; group: CostGroup }) => apiFetch<CostCategory>(`${BASE}/cost-categories`, { method: "POST", body });
export const updateCostCategory = (id: string, body: Partial<Pick<CostCategory, "name" | "group" | "isActive" | "sortOrder">>) => apiFetch<CostCategory>(`${BASE}/cost-categories/${id}`, { method: "PATCH", body });

export const listMaterials = (q: { q?: string } = {}) => apiFetch<{ materials: Material[] }>(`${BASE}/materials${qs(q)}`);
export const createMaterial = (body: Record<string, unknown>) => apiFetch<Material>(`${BASE}/materials`, { method: "POST", body });
export const updateMaterial = (id: string, body: Record<string, unknown>) => apiFetch<Material>(`${BASE}/materials/${id}`, { method: "PATCH", body });

export const listBoms = (q: { productId?: string; status?: BomStatus } = {}) => apiFetch<{ boms: Bom[] }>(`${BASE}/boms${qs(q)}`);
export const createBom = (body: Record<string, unknown>) => apiFetch<Bom>(`${BASE}/boms`, { method: "POST", body });
export const updateBom = (id: string, body: Record<string, unknown>) => apiFetch<Bom>(`${BASE}/boms/${id}`, { method: "PATCH", body });
export const deleteBom = (id: string) => apiFetch<void>(`${BASE}/boms/${id}`, { method: "DELETE" });
export const bomAction = (id: string, action: "approve" | "archive" | "copy") => apiFetch<Bom>(`${BASE}/boms/${id}/${action}`, { method: "POST", body: {} });

export const listProductionOrders = (q: { status?: string; q?: string; page?: number; pageSize?: number } = {}) =>
  apiFetch<{ total: number; productionOrders: ProductionOrder[] }>(`${BASE}/production-orders${qs(q)}`);
export const getProductionOrder = (id: string) => apiFetch<ProductionOrder>(`${BASE}/production-orders/${id}`);
export const createProductionOrder = (body: Record<string, unknown>) => apiFetch<ProductionOrder>(`${BASE}/production-orders`, { method: "POST", body });
export const updateProductionOrder = (id: string, body: Record<string, unknown>) => apiFetch<ProductionOrder>(`${BASE}/production-orders/${id}`, { method: "PATCH", body });
export const deleteProductionOrder = (id: string) => apiFetch<void>(`${BASE}/production-orders/${id}`, { method: "DELETE" });
export const productionOrderAction = (id: string, action: "approve" | "reopen" | "cancel", reason?: string) =>
  apiFetch<ProductionOrder>(`${BASE}/production-orders/${id}/${action}`, { method: "POST", body: reason ? { reason } : {} });

// ── M2: materials custody ─────────────────────────────────────────────────────────────────────────────────────────────
export const listMaterialMoves = (id: string) => apiFetch<{ moves: MaterialMove[] }>(`${BASE}/production-orders/${id}/moves`);
export const issueMaterials = (id: string, body: { lines: Array<{ materialLineId: string; quantity: number }>; note?: string | null; overIssueReason?: string | null }, idempotencyKey: string) =>
  apiFetch<ProductionOrder>(`${BASE}/production-orders/${id}/issue`, { method: "POST", body, idempotencyKey });
export const returnMaterials = (id: string, body: { lines: Array<{ materialLineId: string; quantity: number }>; note?: string | null }, idempotencyKey: string) =>
  apiFetch<ProductionOrder>(`${BASE}/production-orders/${id}/return`, { method: "POST", body, idempotencyKey });
export const declareMaterialUsage = (id: string, lines: Array<{ materialLineId: string; consumedQty: number; scrappedQty: number }>) =>
  apiFetch<ProductionOrder>(`${BASE}/production-orders/${id}/material-usage`, { method: "PUT", body: { lines } });
