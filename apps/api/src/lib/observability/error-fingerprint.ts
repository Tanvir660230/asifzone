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
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.replace(/\\/g, "/");
    const at = line.search(/\/(src|_next)\//);
    if (at < 0) continue;
    return line
      .slice(at + 1)
      .replace(/[?#][^:)\s]*/g, "")
      .replace(/(:\d+)+\)?\s*$/, "")
      .trim();
  }
  return "";
}

/** Stable group key for one kind of failure: source | error name | normalized message | first own stack frame. */
export function fingerprintError(captured: CapturedError): string {
  const err = captured.error instanceof Error ? captured.error : null;
  const name = err?.name ?? typeof captured.error;
  const message = err ? err.message : String(captured.error);
  const parts = [errorSource(captured), name, normalizeMessage(message), firstOwnFrame(err?.stack)];
  return createHash("sha1").update(parts.join("|")).digest("hex");
}
