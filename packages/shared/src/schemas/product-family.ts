import { z } from "zod";

/* Product families (docs/VARIANT_GROUPS_AND_LANDING_PAGES.md §3): a hand-made set of matching products — the same cap in
   several colours, a jacket in sleeveless and full-sleeve — shown together as photo tiles on each member's product page.
   A family only links products: every member keeps its own page, SKUs, stock, price and order lines. Nothing ever
   groups products by name; the admin chooses each member. */

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.preprocess((v) => (v === null || v === "" ? undefined : v), text(max).optional());

export const PRODUCT_FAMILY_MAX_MEMBERS = 24;

export const saveProductFamilySchema = z.object({
  name: text(80).min(1, "Give the family a name"),
  /** In the order the tiles show. */
  members: z
    .array(z.object({ productId: z.string().min(1).max(40), label: optionalText(60) }))
    .min(2, "A family needs at least two products")
    .max(PRODUCT_FAMILY_MAX_MEMBERS)
    .refine((m) => new Set(m.map((x) => x.productId)).size === m.length, "A product is listed twice"),
});
export type SaveProductFamilyInput = z.input<typeof saveProductFamilySchema>;
export type SaveProductFamily = z.infer<typeof saveProductFamilySchema>;

export interface ProductFamilySummary {
  id: string;
  name: string;
  memberCount: number;
  /** Up to four members' first photos, for the list. */
  imageUrls: string[];
  updatedAt: string;
}

export interface ProductFamilyDetail {
  id: string;
  name: string;
  updatedAt: string;
  members: Array<{ productId: string; name: string; slug: string; status: string; imageUrl: string | null; label: string | null }>;
}

/** What a product page shows: only members on sale (published, not in Trash); a family left with one is not sent. */
export interface PublicProductFamily {
  id: string;
  name: string;
  members: Array<{
    productId: string;
    slug: string;
    /** The tile's name: the member's own label, else its product name without the words every member starts with. */
    label: string;
    imageUrl: string | null;
    imageAlt: string | null;
    /** The lowest selling price among its variants, as the server resolves it. */
    price: number;
    /** Some variant can be ordered now; false = shown struck through, still linked. */
    available: boolean;
  }>;
}
