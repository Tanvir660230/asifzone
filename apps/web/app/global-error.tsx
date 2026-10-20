"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { CHUNK_RELOAD_KEY, isChunkLoadError, shouldReloadForChunkError } from "@/lib/chunk-error";
import { sessionGet, sessionSet } from "@/lib/safe-storage";

/** Last-resort boundary for an error that escapes every other error.tsx — without this, an
 * uncaught client error unmounts the whole tree and the visitor gets a blank white page with no
 * way forward. Must render its own <html>/<body> (it replaces the root layout entirely) and stay
 * dependency-free, since whatever broke the app might have taken shared providers/components
 * down with it — its imports (the crash reporter, the chunk-error check, safe session storage) are self-contained and
 * never throw. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunkError = isChunkLoadError(error);
  useEffect(() => {
    reportClientError(error, "boundary", error.digest);
    // Part of the site's code didn't download (weak connection, or a page from before a deploy): a fresh load usually
    // works, so do it once by itself instead of showing this screen.
    if (chunkError && shouldReloadForChunkError(sessionGet(CHUNK_RELOAD_KEY))) {
      sessionSet(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }
  }, [error, chunkError]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "2rem",
            textAlign: "center",
            fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
            color: "#1c1917",
            background: "#faf9f7",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ maxWidth: "24rem", margin: 0, color: "#78716c", fontSize: "0.95rem" }}>
            Sorry about that — please try again. If it keeps happening, reloading usually fixes it.
          </p>
          <button
            type="button"
            // A missing code file stays missing on a re-render; only a fresh load fetches it.
            onClick={() => (chunkError ? window.location.reload() : reset())}
            style={{
              marginTop: "0.5rem",
              padding: "0.65rem 1.5rem",
              borderRadius: "9999px",
              border: "none",
              background: "#1c1917",
              color: "#fff",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
