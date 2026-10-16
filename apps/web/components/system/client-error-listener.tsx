"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/** Site health: reports errors no React boundary sees — a throw in an event handler, a rejected promise nobody awaited —
 * to Admin › System health. Renders nothing. Boundary crashes are reported by app/global-error.tsx. */
export function ClientErrorListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError(event.error ?? event.message, "unhandled");
    const onRejection = (event: PromiseRejectionEvent) => reportClientError(event.reason, "unhandled");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
