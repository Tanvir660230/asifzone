import { sendBeaconJson } from "./beacon";
import { apiBaseUrl } from "./runtime-config";

/** Site health: the browser's half of crash reporting. Errors from the store's own code reach Admin › System health
 * through POST /api/v1/client-errors (apps/api/src/modules/ops/client-errors.routes.ts); browser noise and errors thrown
 * only by extensions or ad/analytics scripts are dropped here, so the list stays about the store. */

const NOISE = [/^ResizeObserver loop/i, /^Script error\.?$/i];
const MAX_REPORTS_PER_PAGE = 5;
const MESSAGE_MAX = 500;
const STACK_MAX = 4000;

let sent = new Set<string>();

export function resetClientErrorReportsForTest(): void {
  sent = new Set();
}

/** False for known noise, and for a stack whose frames all come from somewhere other than this site's bundles. */
export function shouldReportClientError(message: string, stack: string | undefined): boolean {
  if (NOISE.some((re) => re.test(message.trim()))) return false;
  if (!stack) return true;
  const frames = stack.split("\n").slice(1).filter((l) => l.includes("at ") || l.includes("@"));
  if (frames.length === 0) return true;
  return frames.some((l) => l.includes("/_next/"));
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack };
  if (typeof error === "string") return { message: error };
  try {
    return { message: `Non-error thrown: ${JSON.stringify(error) ?? String(error)}` };
  } catch {
    return { message: "Non-error thrown" };
  }
}

export function reportClientError(error: unknown, kind: "boundary" | "unhandled", digest?: string): void {
  try {
    const { message, stack } = describe(error);
    if (!shouldReportClientError(error instanceof Error ? error.message : message, stack)) return;
    const key = `${kind}|${message}`;
    if (sent.has(key) || sent.size >= MAX_REPORTS_PER_PAGE) return;
    sent.add(key);
    sendBeaconJson(`${apiBaseUrl()}/api/v1/client-errors`, {
      message: message.slice(0, MESSAGE_MAX),
      stack: stack?.slice(0, STACK_MAX),
      digest: digest?.slice(0, 64),
      path: (typeof location !== "undefined" ? location.pathname : "/").slice(0, 300) || "/",
      kind,
    });
  } catch {
    // reporting must never add a second failure
  }
}
