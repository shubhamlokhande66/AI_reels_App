"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/useErrorReport";

/** The whole app broke (above app/error.tsx): no styles, texts or providers are left here, only a reload. */
export default function GlobalError({ error }: { error: unknown }) {
  useEffect(() => { const e = error instanceof Error ? error : new Error(String(error)); reportError("crash", e.message, e.stack ?? ""); }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "64px 16px" }}>
        <h1>Something went wrong</h1>
        <button type="button" onClick={() => location.reload()}>Reload</button>
      </body>
    </html>
  );
}
