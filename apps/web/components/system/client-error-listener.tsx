"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { CHUNK_RELOAD_KEY, isChunkLoadError, isTruncatedScriptError, shouldReloadForChunkError } from "@/lib/chunk-error";
import { sessionGet, sessionSet } from "@/lib/safe-storage";

/** A file of the site's code didn't download (weak connection, or a page from before a deploy): load the page again once
 * instead of leaving it half-working. True when it reloads (nothing to report: the visitor gets a working page). */
function recoverFromMissingCode(error: unknown, filename?: string): boolean {
  if (!isChunkLoadError(error) && !isTruncatedScriptError(error, filename)) return false;
  if (!shouldReloadForChunkError(sessionGet(CHUNK_RELOAD_KEY))) return false;
  sessionSet(CHUNK_RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

/** Site health: reports errors no React boundary sees — a throw in an event handler, a rejected promise nobody awaited —
 * to Admin › System health. Renders nothing. Boundary crashes are reported by app/global-error.tsx. */
export function ClientErrorListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const error = event.error ?? event.message;
      if (recoverFromMissingCode(error, event.filename)) return;
      reportClientError(error, "unhandled");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (recoverFromMissingCode(event.reason)) return;
      reportClientError(event.reason, "unhandled");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
