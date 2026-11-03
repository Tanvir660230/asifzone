import { z } from "zod";

/* Grouping separate products into one parent (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §1). The admin picks the parent
   and each product to fold in; nothing is ever grouped by name. Each source's variants move with their ids, SKUs and
   stock; a source's colour can be renamed on the way (two "Black" designs become "Black A" and "Black B") and sizes
   can be mapped onto the parent's spelling ("L 22.5" → "L/22.5"). */

const name = z.string().trim().min(1).max(80);

export const productGroupingSchema = z.object({
  parentId: z.string().min(1).max(40),
  sources: z
    .array(
      z.object({
        productId: z.string().min(1).max(40),
        /** The colour its variants carry in the parent. Absent = keep their own. Only for a single-colour source. */
        color: name.optional(),
        colorHex: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour").nullable().optional()),
      }),
    )
    .min(1, "Choose at least one product to fold in")
    .max(40),
  /** Size spellings to rewrite on the moved variants, e.g. { "L 22.5": "L/22.5" }. */
  sizeRenames: z.record(name, name).default({}),
});
export type ProductGroupingInput = z.input<typeof productGroupingSchema>;

export interface GroupingVariantPlan {
  variantId: string;
  sku: string;
  fromProductId: string;
  fromProductName: string;
  size: string;
  color: string;
  stock: number;
  /** The price it sells at now and will after the move (the move pins it when the parent's base price differs). */
  price: string;
  /** Sells in the parent? An unpublished source's variants move inactive, as they could not be bought before. */
  active: boolean;
}

export interface GroupingPlan {
  parent: { id: string; name: string; slug: string; variantCount: number };
  variants: GroupingVariantPlan[];
  images: number;
  reviews: number;
  /** Redirects that will be added (old product and landing page addresses → the parent's). */
  redirects: { from: string; to: string }[];
  /** Things the admin should know but that don't stop the grouping. */
  notes: string[];
  /** Reasons the grouping can't run as asked; empty = ready. */
  blockers: string[];
}

export interface ProductGroupingSummary {
  id: string;
  parentId: string;
  sources: { id: string; name: string; slug: string }[];
  variantCount: number;
  createdAt: string;
  createdByName: string | null;
  undoneAt: string | null;
}
