import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { liveProvidersEnabled } from "../../lib/provider-guard";
import { logger } from "../../lib/observability/logger";
import { MetaApiError, ProviderNotConfiguredError } from "../errors";

/**
 * Meta Graph API for the Social Inbox: replies on WhatsApp (Cloud API), Messenger, Instagram and Page comments, and
 * a customer's display name. Reached only through providers/registry.ts (`getProviders().social`).
 *
 * Tokens travel in the Authorization header — never in a URL, a log line or an error message. Outside production
 * (LIVE_PROVIDERS=off, tests) nothing is sent: the call is logged and answered with a made-up id.
 */

export const META_GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = 10_000;

export interface GraphRequest {
  /** Path after the version, e.g. "/123/messages". */
  path: string;
  token: "page" | "whatsapp";
  body: Record<string, unknown>;
}

// ── Requests (pure) ─────────────────────────────────────────────────────────────────────────────

export function whatsAppTextRequest(to: string, body: string): GraphRequest {
  return {
    path: `/${env.whatsapp.phoneNumberId}/messages`,
    token: "whatsapp",
    body: { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body, preview_url: true } },
  };
}

/** Messenger and Instagram (Instagram messaging through the Facebook Page, with the Page token) share this call. Past
 * 24 hours a human reply must carry the HUMAN_AGENT tag (allowed up to 7 days). */
export function pageMessageRequest(recipientId: string, body: string, humanAgentTag: boolean): GraphRequest {
  return {
    path: `/${env.metaInbox.pageId}/messages`,
    token: "page",
    body: {
      recipient: { id: recipientId },
      messaging_type: humanAgentTag ? "MESSAGE_TAG" : "RESPONSE",
      ...(humanAgentTag ? { tag: "HUMAN_AGENT" } : {}),
      message: { text: body },
    },
  };
}

export function commentReplyRequest(commentId: string, body: string): GraphRequest {
  return { path: `/${commentId}/comments`, token: "page", body: { message: body } };
}

/** A private reply opens a Messenger conversation with the commenter (once per comment, within 7 days of it). */
export function privateReplyRequest(commentId: string, body: string): GraphRequest {
  return { path: `/${env.metaInbox.pageId}/messages`, token: "page", body: { recipient: { comment_id: commentId }, message: { text: body } } };
}

// ── Transport ───────────────────────────────────────────────────────────────────────────────────

interface GraphBody {
  error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; fbtrace_id?: string };
  id?: string;
  message_id?: string;
  messages?: Array<{ id?: string }>;
  name?: string;
  username?: string;
}

function tokenFor(kind: GraphRequest["token"]): string {
  const token = kind === "whatsapp" ? env.whatsapp.accessToken : env.metaInbox.pageAccessToken;
  if (!token) throw new ProviderNotConfiguredError(kind === "whatsapp" ? "WhatsApp" : "Facebook Page messaging", kind === "whatsapp" ? "WHATSAPP_ACCESS_TOKEN" : "META_PAGE_ACCESS_TOKEN");
  return token;
}

async function graphFetch(method: "GET" | "POST", path: string, token: string, body?: Record<string, unknown>): Promise<GraphBody> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new MetaApiError(`request failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as GraphBody;
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    const retryable = res.status >= 500 || res.status === 429 || e.is_transient === true;
    throw new MetaApiError(`${e.message ?? `HTTP ${res.status}`} (code ${e.code ?? "?"}/${e.error_subcode ?? "-"}, fbtrace ${e.fbtrace_id ?? "-"})`, retryable);
  }
  return json;
}

/** Sends one request; returns Meta's id for what was created (wamid / mid / comment id). */
export async function postGraph(req: GraphRequest): Promise<string> {
  const token = tokenFor(req.token);
  if (!liveProvidersEnabled()) {
    logger.info("[social] (dev mode, not actually sent)", { path: req.path, bytes: JSON.stringify(req.body).length });
    return `dev_${randomUUID()}`;
  }
  const json = await graphFetch("POST", req.path, token, req.body);
  const id = json.messages?.[0]?.id ?? json.message_id ?? json.id;
  if (!id) throw new MetaApiError("Meta accepted the request but returned no id", false);
  return id;
}

// ── WhatsApp templates (replies after the 24-hour window) ──────────────────────────────────────

export interface TemplateSend {
  name: string;
  language: string;
  params: string[];
  /** Named placeholders ({{order_number}}) are sent with their names; positional ones ({{1}}) in order. */
  paramNames: string[] | null;
}

export function whatsAppTemplateRequest(to: string, t: TemplateSend): GraphRequest {
  const parameters = t.params.map((text, i) => ({ type: "text", text, ...(t.paramNames ? { parameter_name: t.paramNames[i] } : {}) }));
  return {
    path: `/${env.whatsapp.phoneNumberId}/messages`,
    token: "whatsapp",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: { name: t.name, language: { code: t.language }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) },
    },
  };
}

export interface RawTemplate {
  name: string;
  language: string;
  category: string;
  parameterFormat: "POSITIONAL" | "NAMED";
  components: Array<{ type: string; format?: string; text?: string; buttons?: Array<{ type?: string; url?: string; example?: unknown }> }>;
}

/** The WhatsApp account's approved templates (needs WHATSAPP_WABA_ID — Connect WhatsApp saves it). */
export async function fetchApprovedTemplates(): Promise<RawTemplate[]> {
  const token = tokenFor("whatsapp");
  const wabaId = env.whatsapp.wabaId;
  if (!wabaId) throw new ProviderNotConfiguredError("WhatsApp templates", "WHATSAPP_WABA_ID");
  if (!liveProvidersEnabled()) return [];
  type Raw = { data?: Array<{ name?: string; language?: string; category?: string; status?: string; parameter_format?: string; components?: RawTemplate["components"] }> };
  const query = new URLSearchParams({ fields: "name,language,category,status,parameter_format,components", status: "APPROVED", limit: "200" });
  const json = (await graphFetch("GET", `/${wabaId}/message_templates?${query.toString()}`, token)) as Raw;
  return (json.data ?? [])
    .filter((t) => t.name && t.language && t.status === "APPROVED")
    .map((t) => ({
      name: t.name!,
      language: t.language!,
      category: t.category ?? "UTILITY",
      parameterFormat: t.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL",
      components: t.components ?? [],
    }));
}

// ── Past Messenger / Instagram chats (Import past chats) ───────────────────────────────────────

export interface PageConversation {
  id: string;
  updatedTime: string;
  participants: Array<{ id: string; name: string | null }>;
  /** Meta details only the 20 most recent messages of a conversation. */
  messages: Array<{ id: string; createdTime: string; fromId: string; text: string | null; hasAttachment: boolean }>;
}

const MAX_IMPORT_CONVERSATIONS = 500;

/** The Page's Messenger or Instagram conversations updated since `since`, newest first (at most 500). */
export async function fetchPageConversations(platform: "messenger" | "instagram", since: Date): Promise<PageConversation[]> {
  const token = tokenFor("page");
  if (!liveProvidersEnabled()) return [];
  type Raw = {
    data?: Array<{
      id?: string;
      updated_time?: string;
      participants?: { data?: Array<{ id?: string; name?: string; username?: string }> };
      messages?: { data?: Array<{ id?: string; created_time?: string; message?: string; from?: { id?: string }; attachments?: { data?: unknown[] } }> };
    }>;
    paging?: { cursors?: { after?: string }; next?: string };
  };
  const fields = "id,updated_time,participants,messages.limit(20){id,created_time,message,from,attachments}";
  const out: PageConversation[] = [];
  let after: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ platform, fields, limit: "25", ...(after ? { after } : {}) });
    const json = (await graphFetch("GET", `/${env.metaInbox.pageId}/conversations?${query.toString()}`, token)) as Raw;
    for (const c of json.data ?? []) {
      if (!c.id || !c.updated_time) continue;
      if (new Date(c.updated_time) < since) return out;
      out.push({
        id: c.id,
        updatedTime: c.updated_time,
        participants: (c.participants?.data ?? []).filter((p) => p.id).map((p) => ({ id: p.id!, name: p.name ?? (p.username ? `@${p.username}` : null) })),
        messages: (c.messages?.data ?? [])
          .filter((m) => m.id && m.created_time && m.from?.id)
          .map((m) => ({ id: m.id!, createdTime: m.created_time!, fromId: m.from!.id!, text: m.message?.trim() || null, hasAttachment: Boolean(m.attachments?.data?.length) })),
      });
      if (out.length >= MAX_IMPORT_CONVERSATIONS) return out;
    }
    after = json.paging?.next ? json.paging.cursors?.after : undefined;
    if (!after) return out;
  }
}

// ── WhatsApp Embedded Signup (Connect WhatsApp) ─────────────────────────────────────────────────
// Server-to-server steps after Meta's signup popup, with the customer's business token. Outside production nothing is
// called: a made-up token and number come back so the flow can be exercised locally.

/** Trades the signup's one-time code (30-second lifetime) for the business's token. */
export async function exchangeSignupCode(code: string): Promise<string> {
  const { appId, appSecret } = env.metaInbox;
  if (!appId) throw new ProviderNotConfiguredError("Meta app", "META_APP_ID");
  if (!appSecret) throw new ProviderNotConfiguredError("Meta app", "META_APP_SECRET");
  if (!liveProvidersEnabled()) return `dev_token_${randomUUID()}`;
  // Meta documents this exchange as a GET; the URL is never logged or put in an error.
  const query = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/oauth/access_token?${query.toString()}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new MetaApiError(`token exchange failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as GraphBody & { access_token?: string };
  if (!res.ok || !json.access_token) throw new MetaApiError(json.error?.message ?? `token exchange failed (HTTP ${res.status})`, false);
  return json.access_token;
}

export async function businessPhoneNumbers(wabaId: string, token: string): Promise<Array<{ id: string; display: string | null }>> {
  if (!liveProvidersEnabled()) return [{ id: "100000000000001", display: "+880 1711-000000" }];
  const json = (await graphFetch("GET", `/${wabaId}/phone_numbers?fields=id,display_phone_number`, token)) as { data?: Array<{ id?: string; display_phone_number?: string }> };
  return (json.data ?? []).filter((p) => p.id).map((p) => ({ id: p.id!, display: p.display_phone_number ?? null }));
}

/** Sends the business account's webhooks (messages, echoes) to this app. */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  if (!liveProvidersEnabled()) return;
  await graphFetch("POST", `/${wabaId}/subscribed_apps`, token);
}

/** A new number (not on the WhatsApp Business app) must be registered, with a 6-digit two-step PIN. */
export async function registerPhoneNumber(phoneNumberId: string, token: string, pin: string): Promise<void> {
  if (!liveProvidersEnabled()) return;
  await graphFetch("POST", `/${phoneNumberId}/register`, token, { messaging_product: "whatsapp", pin });
}

/** Coexistence: the one-time syncs of the business app's contacts and then its chat history (within 24 hours of
 * signup, once each — Meta refuses a repeat). */
export async function syncBusinessApp(phoneNumberId: string, token: string, syncType: "smb_app_state_sync" | "history"): Promise<void> {
  if (!liveProvidersEnabled()) return;
  await graphFetch("POST", `/${phoneNumberId}/smb_app_data`, token, { messaging_product: "whatsapp", sync_type: syncType });
}

/** The customer's display name on Messenger / Instagram, or null (unknown, private, or not configured). Never throws. */
export async function fetchProfileName(channel: "MESSENGER" | "INSTAGRAM", userId: string): Promise<string | null> {
  const token = env.metaInbox.pageAccessToken;
  if (!token || !liveProvidersEnabled()) return null;
  try {
    const json = await graphFetch("GET", `/${userId}?fields=${channel === "INSTAGRAM" ? "name,username" : "name"}`, token);
    return json.name?.trim() || (json.username ? `@${json.username}` : null);
  } catch {
    return null;
  }
}
