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
