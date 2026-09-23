import { z } from "zod";

/* ───────────────────────── duplicate ───────────────────────── */

/** What a duplicate can bring along. Everything else is copied always (name aside): category, type, prices, descriptions, brand,
 * attributes and the variants themselves. Never copied, whatever is ticked: SKUs and barcodes (unique — the copy gets fresh SKUs),
 * the slug and canonical URL (the copy gets its own), reviews, orders, wishlists, flash-sale and bundle membership, view counts and
 * history. A duplicate is always a draft. */
export const DUPLICATE_COPY_OPTIONS = [
  { key: "stock", label: "Stock quantities", help: "Off: every variant of the copy starts at 0 in stock, so inventory isn't counted twice.", defaultOn: false },
  { key: "images", label: "Images", help: "The files are copied, so the two products never share a photo. Each variant keeps its own gallery.", defaultOn: true },
  { key: "materialsAndCare", label: "Materials and care", help: "The material composition, the care guide and any product-specific care steps.", defaultOn: true },
  { key: "sections", label: "Page section settings", help: "This product's section overrides, including its highlights, what's included, video and warranty text.", defaultOn: true },
  { key: "faqs", label: "FAQ", help: "The product's questions and answers.", defaultOn: true },
  { key: "relations", label: "Hand-picked related products", help: "Off: the copy uses the automatic recommendation lists.", defaultOn: false },
  { key: "seo", label: "SEO text", help: "SEO title, meta description, focus keyword and social preview text. Identical text on two pages competes in search, so this is off by default; the canonical URL is never copied.", defaultOn: false },
] as const;

export type DuplicateCopyKey = (typeof DUPLICATE_COPY_OPTIONS)[number]["key"];

export const duplicateProductSchema = z.object({
  /** Name of the copy. Defaults to "<name> (copy)". */
  name: z.string().trim().min(1).max(200).optional(),
  /** Only the keys sent override their default (see DUPLICATE_COPY_OPTIONS). */
  copy: z
    .object({
      stock: z.boolean().optional(),
      images: z.boolean().optional(),
      materialsAndCare: z.boolean().optional(),
      sections: z.boolean().optional(),
      faqs: z.boolean().optional(),
      relations: z.boolean().optional(),
      seo: z.boolean().optional(),
    })
    .strict()
    .optional(),
});
export type DuplicateProductInput = z.infer<typeof duplicateProductSchema>;

/** The effective choices once defaults are applied. */
export function resolveDuplicateOptions(input: DuplicateProductInput["copy"]): Record<DuplicateCopyKey, boolean> {
  return Object.fromEntries(DUPLICATE_COPY_OPTIONS.map((o) => [o.key, input?.[o.key] ?? o.defaultOn])) as Record<DuplicateCopyKey, boolean>;
}

export interface DuplicateProductResult {
  /** Id of the new draft product. */
  productId: string;
  slug: string;
  name: string;
  /** What was actually brought over, e.g. { images: 4, variants: 6, faqs: 2 }. */
  copied: Record<string, number>;
  /** Things the admin should know: an image whose files were missing, a section that couldn't be copied … */
  warnings: string[];
}

/* ───────────────────────── CSV import ───────────────────────── */

/** Limits enforced on the server; the import page repeats them so a too-big file is refused before it is sent. */
export const PRODUCT_IMPORT_LIMITS = { maxBytes: 1_500_000, maxRows: 2000, maxProducts: 500 } as const;

export const productImportRequestSchema = z.object({
  /** The CSV file's text (UTF-8; a leading byte-order mark is fine). */
  csv: z.string().min(1, "The file is empty").max(PRODUCT_IMPORT_LIMITS.maxBytes, "The file is too large (1.5 MB max)"),
});
export type ProductImportRequest = z.infer<typeof productImportRequestSchema>;

export const productImportCommitSchema = productImportRequestSchema.extend({
  /** Import the products that pass and leave the invalid ones out. Off (the default), any error stops the whole import. */
  skipInvalid: z.boolean().optional(),
});
export type ProductImportCommit = z.infer<typeof productImportCommitSchema>;

export interface ProductImportIssue {
  /** The CSV line (the header is line 1); null when the problem is about the file or the whole product. */
  row: number | null;
  /** The product the row belongs to (its slug), when known. */
  product: string | null;
  column: string | null;
  message: string;
}

export interface ProductImportItem {
  action: "create" | "update";
  slug: string;
  name: string;
  /** CSV lines that make up this product. */
  rows: number[];
  variants: number;
  /** For updates: what would change, in words. Empty when the file matches what is stored. */
  changes: string[];
}

export interface ProductImportReport {
  /** True when the file has no errors and can be imported. Warnings never block it. */
  ok: boolean;
  summary: { rows: number; products: number; create: number; update: number; unchanged: number; invalid: number };
  errors: ProductImportIssue[];
  warnings: ProductImportIssue[];
  /** The products that would be imported (valid ones only), capped for display. */
  items: ProductImportItem[];
  /** Columns in the file that this import doesn't know; they are ignored. */
  ignoredColumns: string[];
}

export interface ProductImportResult {
  created: number;
  updated: number;
  skipped: number;
  /** Products that passed the check but were refused when written (e.g. someone changed the catalog meanwhile). */
  failed: { slug: string; message: string }[];
  /** The batch id recorded in the audit trail. */
  batchId: string;
}

/* ───────────────────────── sales summary (admin only) ───────────────────────── */

/** What the admin-only panel on the product page shows: units sold in the last `days` days, by the same rule as the storefront's
 * "N sold in the last 7 days" line (every order except cancelled and refunded ones). */
export interface ProductSalesSummary {
  productId: string;
  days: number;
  /** Start of the window (ISO). */
  since: string;
  unitsSold: number;
  /** Orders that contained this product. */
  orders: number;
  byVariant: { variantId: string; sku: string; size: string; color: string; units: number }[];
}
