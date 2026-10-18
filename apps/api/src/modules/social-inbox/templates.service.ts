import { renderTemplate, templatePlaceholders, type TemplateReplyInput, type WhatsAppTemplate } from "@clothing-brand/shared";
import { AppError } from "../../lib/app-error";
import { getProviders } from "../../providers/registry";
import type { RawTemplate, TemplateSend } from "../../providers/social/meta-graph";

/**
 * WhatsApp approved templates — the only messages Meta lets a business send once 24 hours have passed since the
 * customer's last message (Meta charges for each). Owners create them in WhatsApp Manager; the Inbox offers the ones it
 * can fill from text alone: a text (or no) header without blanks, a body with blanks, and buttons without blanks.
 */

const CACHE_MS = 5 * 60_000;
let cache: { at: number; templates: WhatsAppTemplate[] } | null = null;

export function toWhatsAppTemplate(raw: RawTemplate): WhatsAppTemplate | null {
  const header = raw.components.find((c) => c.type === "HEADER");
  const body = raw.components.find((c) => c.type === "BODY");
  const footer = raw.components.find((c) => c.type === "FOOTER");
  const buttons = raw.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  if (!body?.text) return null;
  if (header && (header.format !== "TEXT" || templatePlaceholders(header.text ?? "").length > 0)) return null;
  if (buttons.some((b) => (b.url ?? "").includes("{{") || b.type === "OTP" || b.type === "FLOW" || b.type === "CATALOG" || b.type === "MPM")) return null;
  return {
    name: raw.name,
    language: raw.language,
    category: raw.category,
    header: header?.text ?? null,
    body: body.text,
    footer: footer?.text ?? null,
    params: templatePlaceholders(body.text),
    named: raw.parameterFormat === "NAMED",
  };
}

export async function listTemplates(now = Date.now()): Promise<WhatsAppTemplate[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.templates;
  const templates = (await getProviders().social.approvedTemplates()).map(toWhatsAppTemplate).filter((t): t is WhatsAppTemplate => t !== null);
  cache = { at: now, templates };
  return templates;
}

/** Tests only. */
export function clearTemplateCache() {
  cache = null;
}

/** The template a reply names, filled in: the text to show in the thread and what to send. */
export async function resolveTemplateReply(input: TemplateReplyInput): Promise<{ body: string; send: TemplateSend }> {
  const template = (await listTemplates()).find((t) => t.name === input.name && t.language === input.language);
  if (!template) throw AppError.badRequest("That template isn't approved on this WhatsApp account (any more).", { code: "TEMPLATE_UNKNOWN" });
  if (input.params.length !== template.params.length) {
    throw AppError.badRequest(`This template needs ${template.params.length} value(s).`, { code: "TEMPLATE_PARAMS" });
  }
  return {
    body: renderTemplate(template, input.params),
    send: { name: template.name, language: template.language, params: input.params, paramNames: template.named ? template.params : null },
  };
}
