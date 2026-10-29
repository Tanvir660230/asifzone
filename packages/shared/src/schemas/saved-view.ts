import { z } from "zod";

/** Which list a saved view belongs to — the list's own key ("orders", "customers", …). */
export const savedViewListKey = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "Unknown list");

/** Admin V2 DR-18: save the current filters of a list as a named view. `query` is the list's URL state (no "?"). */
export const createSavedViewSchema = z.object({
  listKey: savedViewListKey,
  label: z.string().trim().min(1, "Give the view a name").max(40),
  query: z.string().max(1000),
  shared: z.boolean().optional(),
});
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;

export const savedViewListQuerySchema = z.object({ list: savedViewListKey });

export interface SavedViewRow {
  id: string;
  listKey: string;
  label: string;
  query: string;
  /** Visible to every admin; only its creator can delete it. */
  shared: boolean;
  /** Created by the admin asking. */
  mine: boolean;
  createdBy: string | null;
}

/** Most views one admin keeps per list. */
export const SAVED_VIEWS_PER_LIST = 30;

/** How dense a list's rows are drawn (Order Operations plan M10). */
export const LIST_DENSITIES = ["compact", "standard", "comfortable"] as const;
export type ListDensity = (typeof LIST_DENSITIES)[number];

/** Rows per page a large admin list offers (M10): 50 by default, up to 200. */
export const LIST_PAGE_SIZES = [25, 50, 100, 200] as const;
export const LIST_DEFAULT_PAGE_SIZE = 50;

/**
 * One admin's display preferences for one list — density, page size and hidden columns — kept on the server so they
 * follow the admin to another device. A link's own `size` still wins over the stored one. Every field is optional: an
 * unset field means the list's default.
 */
export const listPreferencesSchema = z.object({
  density: z.enum(LIST_DENSITIES).optional(),
  pageSize: z.union(LIST_PAGE_SIZES.map((n) => z.literal(n)) as unknown as [z.ZodLiteral<25>, z.ZodLiteral<50>, z.ZodLiteral<100>, z.ZodLiteral<200>]).optional(),
  hiddenColumns: z.array(z.string().regex(/^[a-zA-Z][\w-]{0,39}$/)).max(20).optional(),
});
export type ListPreferences = z.infer<typeof listPreferencesSchema>;
export const listPreferencesParamsSchema = z.object({ list: savedViewListKey });
