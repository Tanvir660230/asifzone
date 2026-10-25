import { apiFetch } from "@/lib/api-client";

/**
 * Cost & profit planning (/api/v1/finance/cost-sheets — docs/COST_SHEET.md): what one sale of each size costs — making
 * and selling — and earns. Money in major units. A planning aid: nothing here is booked.
 */
const BASE = "/api/v1/finance/cost-sheets";

export type CostLineKind = "MAKING" | "PACKAGING" | "COURIER" | "PAYMENT_FEE" | "RETURN_RESERVE" | "ADS" | "LABOUR" | "OTHER";
export type CostLineMode = "AUTO" | "FIXED" | "PERCENT_OF_PRICE";
export type CostLevel = "VARIANT" | "PRODUCT" | "CATEGORY" | "BUSINESS" | "AUTO";

export interface CostSheetLine { kind: CostLineKind; label: string; from: CostLevel; mode: CostLineMode; amount: number | null; fixed: number | null; percent: number; how: string; estimate: boolean }
export interface CostSheetSize {
  variantId: string;
  sku: string;
  label: string;
  price: number;
  lines: CostSheetLine[];
  total: number;
  complete: boolean;
  unknown: CostLineKind[];
  profit: number;
  marginPct: number | null;
  breakEvenAds: number;
  suggestedPrice: number | null;
  belowTarget: boolean;
}
export interface Assumption { value: number; from: CostLevel }
export interface Assumptions { insideDhakaPct: Assumption; codPct: Assumption; returnRatePct: Assumption; targetMarginPct: Assumption }
export interface ProfileLine { kind: CostLineKind; variantId?: string | null; mode: CostLineMode; amount: number | null; label?: string | null }
export interface CostProfile { insideDhakaPct: number | null; codPct: number | null; returnRatePct: number | null; targetMarginPct: number | null; notes: string | null; lines: ProfileLine[] }
/** What the books booked per sale of the size over the last `actualDays` (courier fees include COD and return charges). */
export interface ActualPerSale { units: number; price: number; making: number; packing: number; deliveryAndFees: number; ads: number; profit: number; marginPct: number | null }
export interface ProductCostSheet { productId: string; name: string; categoryId: string; categoryName: string | null; assumptions: Assumptions; sizes: Array<CostSheetSize & { actual: ActualPerSale | null }>; own: CostProfile | null; returnRateActual: number | null; actualDays: number }
export interface ProductCostRow extends Omit<ProductCostSheet, "sizes" | "own" | "returnRateActual" | "actualDays"> {
  sizes: Array<Omit<CostSheetSize, "lines"> & { making: number | null; selling: number }>;
}

export const costSheetKeys = {
  all: ["cost-sheets"] as const,
  product: (id: string) => ["cost-sheets", "product", id] as const,
  list: () => ["cost-sheets", "list"] as const,
  defaults: () => ["cost-sheets", "defaults"] as const,
};

export const getProductCostSheet = (productId: string) => apiFetch<ProductCostSheet>(`${BASE}/products/${productId}`);
export const listProductCosts = () => apiFetch<{ returnRateActual: number | null; products: ProductCostRow[] }>(`${BASE}/products`);
export const getCostDefaults = () =>
  apiFetch<{ shop: CostProfile | null; categories: Array<{ id: string; name: string; profile: CostProfile | null }>; defaults: { insideDhakaPct: number; codPct: number; targetMarginPct: number } }>(`${BASE}/defaults`);
export const saveCostProfile = (scope: "BUSINESS" | "CATEGORY" | "PRODUCT", scopeId: string, body: Omit<CostProfile, "notes"> & { notes?: string | null }) =>
  apiFetch<{ removed: boolean }>(`${BASE}/${scope}${scope === "BUSINESS" ? "" : `/${scopeId}`}`, { method: "PUT", body });

export const KIND_LABEL: Record<CostLineKind, string> = { MAKING: "Making", PACKAGING: "Parcel packing", COURIER: "Delivery", PAYMENT_FEE: "Payment fees", RETURN_RESERVE: "Returns", ADS: "Ads", LABOUR: "Labour", OTHER: "Other" };
export const LEVEL_LABEL: Record<CostLevel, string> = { AUTO: "Auto", VARIANT: "This size", PRODUCT: "This product", CATEGORY: "Category", BUSINESS: "Shop default" };
