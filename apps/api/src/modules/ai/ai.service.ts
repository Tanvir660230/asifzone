import fs from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { AiContentType, GenerateAiContentInput } from "@clothing-brand/shared";
import { env } from "../../config/env";
import { AppError } from "../../lib/app-error";

const MAX_TOKENS = 1024;

let client: Anthropic | null = null;

export function isAiConfigured(): boolean {
  return env.anthropic.apiKey.length > 0;
}

function getClient(): Anthropic {
  if (!isAiConfigured()) {
    throw new AppError(503, "AI features aren't configured — set ANTHROPIC_API_KEY on the API to enable them.");
  }
  // Lazily constructed so a missing key never throws at server startup, only when a route
  // actually needs the client — the rest of the store works with zero Anthropic setup.
  client ??= new Anthropic({ apiKey: env.anthropic.apiKey });
  return client;
}

/** One prompt per content type — this is the only thing that differs between the seven
 * generators; everything else (model call, error handling) is shared in generateContent(). */
function buildPrompt(type: AiContentType, input: GenerateAiContentInput): string {
  const product = input.productName ?? "the product";
  const category = input.category ? ` in the "${input.category}" category` : "";
  const brand = input.brand ? ` from the brand "${input.brand}"` : "";
  const keyPoints = input.keyPoints ? `\n\nKey points to work in: ${input.keyPoints}` : "";
  const tone = input.tone ? input.tone : "warm, premium, and trustworthy";

  switch (type) {
    case "product_description":
      if (!input.productName) throw AppError.badRequest("productName is required for product_description");
      return `Write a compelling e-commerce product description for "${product}"${category}${brand}. Tone: ${tone}. 2-3 short paragraphs, no markdown headings, no emoji. Focus on real, checkable benefits — don't invent specs, materials, or claims not given below.${keyPoints}`;

    case "seo_title":
      if (!input.productName) throw AppError.badRequest("productName is required for seo_title");
      return `Write one SEO title tag for the product "${product}"${category}${brand}. Under 60 characters, no quotes, no trailing punctuation. Reply with only the title, nothing else.`;

    case "meta_description":
      if (!input.productName) throw AppError.badRequest("productName is required for meta_description");
      return `Write one SEO meta description for the product "${product}"${category}${brand}. 140-160 characters, action-oriented, no quotes. Reply with only the meta description, nothing else.${keyPoints}`;

    case "seo_keywords":
      if (!input.productName) throw AppError.badRequest("productName is required for seo_keywords");
      return `List 8-12 SEO keywords/phrases a shopper would search to find "${product}"${category}${brand}. Comma-separated, lowercase, no numbering, no explanation — reply with only the comma-separated list.`;

    case "marketing_copy":
      if (!input.topic) throw AppError.badRequest("topic is required for marketing_copy");
      return `Write short marketing copy (for a banner, social post, or ad) about: ${input.topic}. Tone: ${tone}.${input.audience ? ` Audience: ${input.audience}.` : ""} 2-4 sentences, no hashtags, no emoji, no markdown.`;

    case "email_copy":
      if (!input.topic) throw AppError.badRequest("topic is required for email_copy");
      return `Write a short marketing email about: ${input.topic}. Tone: ${tone}.${input.audience ? ` Audience: ${input.audience}.` : ""} Include a subject line on the first line prefixed "Subject:", then the email body. Keep the body under 150 words, no markdown, no emoji.`;

    case "campaign_suggestion":
      return `Suggest 3 marketing campaign ideas for a clothing e-commerce store${input.topic ? `, focused on: ${input.topic}` : ""}.${input.audience ? ` Target audience: ${input.audience}.` : ""} For each: a campaign name, a one-sentence concept, and a suggested channel (email, social, SMS, etc). Plain text, numbered 1-3, no markdown formatting.`;
  }
}

export async function generateContent(input: GenerateAiContentInput): Promise<string> {
  const prompt = buildPrompt(input.type, input);
  const message = await getClient().messages.create({
    model: env.anthropic.model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  if (message.stop_reason === "refusal") {
    throw AppError.badRequest("The AI declined to generate this content — try rephrasing the input.");
  }

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError(502, "AI returned no text content");
  }
  return textBlock.text.trim();
}

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** `imageUrl` is the relative path stored on ProductImage.url (e.g. "/uploads/products/x.webp") —
 * read straight off local disk rather than round-tripping over HTTP back to this same server. */
export async function generateImageAltText(imageUrl: string): Promise<string> {
  const relative = imageUrl.startsWith("/") ? imageUrl.slice(1) : imageUrl;
  if (relative.includes("..")) throw AppError.badRequest("Invalid image path");

  const uploadsRoot = path.resolve(process.cwd(), env.uploadsDir);
  const filePath = path.resolve(process.cwd(), relative);
  if (!filePath.startsWith(uploadsRoot)) throw AppError.badRequest("Invalid image path");

  const ext = path.extname(filePath).toLowerCase();
  const mediaType = IMAGE_MEDIA_TYPES[ext];
  if (!mediaType) throw AppError.badRequest("Unsupported image type");

  let data: Buffer;
  try {
    data = await fs.readFile(filePath);
  } catch {
    throw AppError.notFound("Image file not found on disk");
  }

  const message = await getClient().messages.create({
    model: env.anthropic.model,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: data.toString("base64") },
          },
          {
            type: "text",
            text: "Write concise, descriptive alt text for this e-commerce product photo, for accessibility and SEO. Describe what's actually visible — garment type, color, notable details. Under 125 characters. Reply with only the alt text, nothing else.",
          },
        ],
      },
    ],
  });

  if (message.stop_reason === "refusal") {
    throw AppError.badRequest("The AI declined to describe this image.");
  }

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError(502, "AI returned no text content");
  }
  return textBlock.text.trim();
}
