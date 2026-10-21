"use client";

import { useEffect } from "react";

/*
 * Last-resort boundary: it replaces the root layout when even the document failed to render,
 * so it carries its own minimal inline styles (no stylesheet, no fonts, no i18n context) and
 * bilingual copy. The error is reported to the self-hosted inbox.
 */

const CHEVRON = "M6.5 7 L16.5 16 L6.5 25";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      const body = JSON.stringify({
        name: error.name,
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        source: "global-error",
        route: location.pathname,
        severity: "error",
        userAgent: navigator.userAgent,
      });
      if (!navigator.sendBeacon?.("/api/errors", new Blob([body], { type: "application/json" }))) {
        fetch("/api/errors", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch((e: unknown) => {
          console.warn("[errors] report failed", e);
        });
      }
    } catch (e) {
      console.warn("[errors] report failed", e);
    }
  }, [error]);

  const zh = typeof document !== "undefined" && document.documentElement.lang.startsWith("zh");

  return (
    <html lang={zh ? "zh-CN" : "en"}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 16,
          background: "#F5F4F0",
          color: "#121614",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', sans-serif",
        }}
      >
        <main
          style={{
            width: "100%",
            maxWidth: 440,
            boxSizing: "border-box",
            textAlign: "center",
            background: "#FFFFFF",
            borderRadius: 28,
            padding: "44px 28px",
            boxShadow: "0 0 0 1px rgba(18,22,20,.08), 0 14px 32px -16px rgba(18,22,20,.16), 0 46px 90px -44px rgba(18,22,20,.24)",
          }}
        >
          <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true">
            <path d={CHEVRON} fill="none" stroke="#121614" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="25.5" cy="16" r="3.25" fill="#1E5A48" />
          </svg>
          <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: "18px 0 10px", fontWeight: 700, letterSpacing: "-0.02em" }}>
            {zh ? "这是我们的问题。" : "That one’s on us."}
          </h1>
          <p style={{ color: "#3E4541", lineHeight: 1.6, margin: 0 }}>
            {zh
              ? "错误已经记录，它没有导致任何提交或扣费。请重试。"
              : "The error has been logged. Nothing was submitted or charged because of it. Please try again."}
          </p>
          {error.digest ? <p style={{ color: "#626A65", fontSize: 12, marginTop: 10, fontFamily: "ui-monospace, monospace" }}>{error.digest}</p> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 26, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                minHeight: 48,
                padding: "0 22px",
                borderRadius: 999,
                border: 0,
                background: "#E4572E",
                color: "#121614",
                fontWeight: 650,
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              {zh ? "重试" : "Try again"}
            </button>
            <a
              href={zh ? "/zh" : "/"}
              style={{
                minHeight: 48,
                display: "inline-flex",
                alignItems: "center",
                padding: "0 22px",
                borderRadius: 999,
                background: "#F8F7F3",
                boxShadow: "inset 0 0 0 1px rgba(18,22,20,.14)",
                color: "#121614",
                fontWeight: 600,
                fontSize: 16,
                textDecoration: "none",
              }}
            >
              {zh ? "回到首页" : "Go home"}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
