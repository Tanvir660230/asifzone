import "dotenv/config";
import { installationNamespace, resolveInstallId, type InstallationNamespace } from "@clothing-brand/shared";

/**
 * This process's installation (Phase 1) — the one place the API learns which store deployment it is. Everything that
 * must stay apart when several installations share infrastructure derives from it: Redis cache keys, locks and BullMQ
 * queues (`namespace`), and the local demo-mirror database name (config/database-guard.ts).
 *
 * `INSTALL_ID` is required in production (docker/.env, checked by docker/deploy.sh's preflight). Outside production it
 * defaults to `local` (`test` under NODE_ENV=test) so a developer machine works without extra setup.
 *
 * Read straight from process.env (not config/env.ts) because database-guard.ts needs it before env.ts finishes loading.
 * The rule itself (shared with the web app) is @clothing-brand/shared resolveInstallId.
 */
export const installId = resolveInstallId(process.env);

export const namespace: InstallationNamespace = installationNamespace(installId);

/**
 * JWT audience binding every session token this installation signs to this installation (docs/BUSINESS_DECISIONS.md D17).
 * Installations never share JWT secrets (docs/STORE_DEPLOYMENT.md); if two ever do by mistake, one still refuses the
 * other's tokens.
 */
export const TOKEN_AUDIENCE = `install:${installId}`;

/** Throws when a verified token was issued by another installation. A token without an audience was issued before tokens
 * named their installation; it is accepted until it expires, so the deploy that introduces the claim logs nobody out. */
export function assertTokenInstallation(payload: { aud?: unknown }): void {
  if (payload.aud === undefined) return;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(TOKEN_AUDIENCE)) throw new Error("token was issued by another installation");
}
