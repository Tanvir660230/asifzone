import { z } from "zod";

/** Live values a saved answer can contain — filled in each time it is sent, so it never goes stale. */
export const SAVED_ANSWER_PLACEHOLDERS = [
  { key: "delivery_charges", label: "Delivery charges", example: "Dhaka: 60 taka, Outside Dhaka: 120 taka" },
  { key: "delivery_time", label: "Delivery time", example: "Dhakar bhetore 1–2 din, Dhakar baire 3–5 din" },
  { key: "cod", label: "Cash on delivery", example: "Cash on delivery ache" },
  { key: "website", label: "Website", example: "your website address" },
  { key: "store_name", label: "Store name", example: "your store name" },
  { key: "name", label: "Customer's name", example: "Rahim" },
] as const;

export const createSavedAnswerSchema = z.object({
  title: z.string().trim().min(1, "Write the question").max(200),
  answer: z.string().trim().min(1, "Write the answer").max(1000),
  /** Other ways customers ask it (one per entry). */
  examples: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  autoSend: z.boolean().default(false),
});
export type CreateSavedAnswerInput = z.input<typeof createSavedAnswerSchema>;

export const updateSavedAnswerSchema = z
  .object({
    status: z.enum(["APPROVED", "DISMISSED"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    answer: z.string().trim().min(1).max(1000).optional(),
    autoSend: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to change" });
export type UpdateSavedAnswerInput = z.infer<typeof updateSavedAnswerSchema>;

export interface SavedAnswerView {
  id: string;
  status: "SUGGESTED" | "APPROVED" | "DISMISSED";
  title: string;
  answer: string;
  autoSend: boolean;
  hits: number;
  corrections: number;
  lastHitAt: string | null;
  /** Auto-send was paused by itself because staff kept rewriting this answer. */
  autoPausedAt: string | null;
  createdAt: string;
  exampleCount: number;
  /** A few of the ways customers asked it. */
  examples: string[];
}

export interface SavedAnswersList {
  suggested: SavedAnswerView[];
  approved: SavedAnswerView[];
  /** Replies the library sent (or drafted and staff sent unchanged) in the last 30 days — AI calls not made. */
  answeredWithoutAi: number;
}
