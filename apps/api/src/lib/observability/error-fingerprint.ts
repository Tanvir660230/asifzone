import { createHash } from "node:crypto";
import type { CapturedError } from "./error-capture";

/** Website (beacon from the storefront/admin browser) or this API process. */
export type ErrorSource = "api" | "web";

export function errorSource(captured: CapturedError): ErrorSource {
  return captured.context?.source === "web" ? "web" : "api";
}

/** Ids, amounts and quoted values vary per occurrence; without this every order number would open its own group. */
function normalizeMessage(message: string): string {
  return message
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"…"')
    .replace(/\d+/g, "#")
    .slice(0, 300);
}

/** The first frame in our own code (API `src/`, Next.js `_next/`), from that folder on — so the same throw site matches
 * across machines and deploys (line:col and query strings dropped). */
function firstOwnFrame(stack: string | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n");
  // V8 stacks start with an "Error: message" header; Firefox/Safari stacks (fn@url:line:col) start with a frame.
  const frames = /^\s*at\s|@/.test(lines[0] ?? "") ? lines : lines.slice(1);
  for (const raw of frames) {
    const line = raw.replace(/\\/g, "/");
    if (line.includes("/node_modules/")) continue;
    // src/ (tsx, tests), dist/ (the compiled API in production), _next/ (website bundles)
    const at = line.search(/\/(src|dist|_next)\//);
    if (at < 0) continue;
    return line
      .slice(at + 1)
      .replace(/[?#][^:)\s]*/g, "")
      .replace(/(:\d+)+\)?\s*$/, "")
      // Website chunk names change every deploy (content hash, numeric chunk id) — keep the route part only.
      .replace(/[-.][0-9a-f]{6,}(?=\.m?js\b)/gi, "")
      .replace(/\b\d+(?=\.m?js\b)/g, "#")
      .trim();
  }
  return "";
}

/** Stable group key for one kind of failure: source | error name | normalized message | first own stack frame | digest.
 * The digest is Next.js's id for a server-render failure; production hides that error's message from the browser, so
 * without it every such failure would look the same. */
export function fingerprintError(captured: CapturedError): string {
  const err = captured.error instanceof Error ? captured.error : null;
  const name = err?.name ?? typeof captured.error;
  const message = err ? err.message : String(captured.error);
  const digest = typeof captured.context?.digest === "string" ? captured.context.digest : "";
  const parts = [errorSource(captured), name, normalizeMessage(message), firstOwnFrame(err?.stack), digest];
  return createHash("sha1").update(parts.join("|")).digest("hex");
}
