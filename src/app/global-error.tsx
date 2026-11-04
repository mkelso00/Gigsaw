"use client";

import { useEffect } from "react";

// The last line of defence: shown when the root layout itself fails, so it replaces the whole
// document. Nothing from the layout is available here (fonts, stylesheet), so it carries its own
// <html> and inline styles in the same desk colours, and "Try again" reloads the page from scratch.

const ink950 = "#15181c";
const ink500 = "#67707a";

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(`Page error${error.digest ? ` (reference ${error.digest})` : ""}`, error);
  }, [error]);
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const button: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    padding: "0 16px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    fontFamily: "inherit",
    textDecoration: "none",
    cursor: "pointer",
  };
  return (
    <html lang="en-GB">
      <head>
        <title>Something went wrong · Gigsaw</title>
        <meta name="robots" content="noindex" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#eef0f2",
          color: ink950,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <main style={{ maxWidth: 448, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 3 }} aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} style={{ width: 5, height: 8, borderRadius: 1, background: i >= 8 ? "#e0287a" : "#22c7a6" }} />
            ))}
          </div>
          <p
            style={{ margin: "12px 0 0", fontFamily: mono, fontSize: 11, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: ink500 }}
          >
            Error
          </p>
          <h1 style={{ margin: "16px 0 0", fontSize: 28, lineHeight: 1.2, fontWeight: 700, letterSpacing: "-0.015em", fontStretch: "125%" }}>
            Something went wrong on our side
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.6, color: "#4c545d" }}>
            Try again in a moment. If it keeps happening, email hello@gigsaw.live and quote the reference below.
          </p>
          <div style={{ marginTop: 32, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
            {/* A plain link, not next/link: the app around it may be what broke. */}
            <a href="/" style={{ ...button, border: "1px solid #d3d7dc", background: "#fff", color: ink950 }}>
              Go to the home page
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ ...button, border: `1px solid ${ink950}`, background: ink950, color: "#fff" }}
            >
              Try again
            </button>
          </div>
          {error.digest && (
            <p style={{ margin: "32px 0 0", fontFamily: mono, fontSize: 12, color: ink500 }}>
              Reference: <span style={{ color: "#363c43", userSelect: "all" }}>{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
