"use client";

/**
 * Last-resort error boundary.
 *
 * Catches what nothing else can — errors thrown by a layout, including the root
 * one. Without this file, such an error renders Next's bare "Application error:
 * a server-side exception has occurred": no styling, no navigation, no way
 * forward.
 *
 * It has to render its own <html> and <body>, because the failure may have been
 * in the layout that would normally provide them.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f7f5f3",
          color: "#1a1a1a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          padding: "24px",
        }}
      >
        {/* Inline styles deliberately: if the stylesheet failed to load, Tailwind
            classes here would render nothing at all. */}
        <div
          style={{
            maxWidth: 520,
            backgroundColor: "#fff",
            border: "1px solid #e8e4e0",
            borderRadius: 16,
            padding: "40px 32px",
            textAlign: "center",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#8c1515",
            }}
          >
            Something Broke
          </p>
          <h1
            style={{
              margin: "12px 0 0",
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            SkyRunners HQ couldn&apos;t load
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: 15, color: "#5f5f5f" }}>
            This is usually temporary. Try again — and if it keeps happening,
            send whoever is on call the message below.
          </p>

          {error.digest ? (
            <p
              style={{
                margin: "20px 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                color: "#8a8a8a",
              }}
            >
              Error ref: {error.digest}
            </p>
          ) : null}

          <div
            style={{
              marginTop: 24,
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={reset}
              style={{
                backgroundColor: "#8c1515",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "12px 20px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/my-work"
              style={{
                backgroundColor: "#fff",
                color: "#1a1a1a",
                border: "1px solid #e8e4e0",
                borderRadius: 12,
                padding: "12px 20px",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go to My Work
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
