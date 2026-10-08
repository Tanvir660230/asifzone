import { z } from "zod";

export const aiContentTypeEnum = z.enum([
  "product_description",
  "seo_title",
  "meta_description",
  "seo_keywords",
  "marketing_copy",
  "email_copy",
  "campaign_suggestion",
]);

/** Every field here is optional at the schema level — which ones are actually required for a
 * given `type` is enforced in ai.service.ts's prompt builder, not here, since the required set
 * differs per type. */
export const generateAiContentSchema = z.object({
  type: aiContentTypeEnum,
  productName: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  brand: z.string().max(120).optional(),
  keyPoints: z.string().max(1000).optional(),
  tone: z.string().max(60).optional(),
  topic: z.string().max(500).optional(),
  audience: z.string().max(200).optional(),
});

export const generateImageAltTextSchema = z.object({
  imageUrl: z.string().min(1).max(500),
});

export type AiContentType = z.infer<typeof aiContentTypeEnum>;
export type GenerateAiContentInput = z.infer<typeof generateAiContentSchema>;
export type GenerateImageAltTextInput = z.infer<typeof generateImageAltTextSchema>;

// ── Assistant tool layer (Blueprint V2 §T, DR-23) ──────────────────────────────────────────────────────────────────────

/** One turn of the assistant conversation the browser keeps; tool results are never sent back — the server re-reads. */
export const aiChatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === "user", "The last message must be the admin's"),
});
export type AiChatInput = z.infer<typeof aiChatSchema>;

/** A read tool's result, shown under the reply. `rows` are already minimised (phones masked). */
export interface AiResultCard {
  tool: string;
  title: string;
  rows: Array<Record<string, string | number | null>>;
  /** Admin page that shows the same data in full. */
  href?: string;
}

/** A change the assistant prepared. Nothing happens until an admin with ai.execute confirms it (DR-23). */
export interface AiProposalView {
  id: string;
  tool: string;
  title: string;
  /** What will happen, line by line — the same consequence text the human dialogs show. */
  effects: string[];
  status: "PENDING" | "EXECUTED" | "CANCELLED" | "FAILED" | "EXPIRED";
  expiresAt: string;
  href?: string;
}

export interface AiChatResponse {
  reply: string;
  cards: AiResultCard[];
  proposals: AiProposalView[];
}

/** An execute tool touches one entity, or at most this many in a bulk tool (DR-23). */
export const AI_BULK_CAP = 50;
/** How long a proposal can be confirmed. */
export const AI_PROPOSAL_TTL_MS = 10 * 60 * 1000;
