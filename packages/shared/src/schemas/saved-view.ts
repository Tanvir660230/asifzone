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
