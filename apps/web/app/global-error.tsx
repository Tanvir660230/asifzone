"use client";

/** Last-resort boundary for an error that escapes every other error.tsx — without this, an
 * uncaught client error unmounts the whole tree and the visitor gets a blank white page with no
 * way forward. Must render its own <html>/<body> (it replaces the root layout entirely) and stay
 * dependency-free, since whatever broke the app might have taken shared providers/components
 * down with it. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
            onClick={() => reset()}
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
