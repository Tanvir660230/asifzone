import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";

let cached: { clientId: string; client: OAuth2Client } | null = null;

/** The Google ID-token verifier for this store's OAuth client ID (Settings › Integrations or GOOGLE_CLIENT_ID), or null
 * when sign-in with Google isn't configured. Rebuilt when the client ID changes. */
export function googleOAuthClient(): OAuth2Client | null {
  const clientId = env.google.clientId;
  if (!clientId) return null;
  if (cached?.clientId !== clientId) cached = { clientId, client: new OAuth2Client(clientId) };
  return cached.client;
}
