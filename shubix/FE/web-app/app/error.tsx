"use client";

import { useEffect } from "react";
import { Button, Heading } from "@/components/atoms";
import { useText } from "@/hooks/useApi";
import { reportError } from "@/lib/useErrorReport";

/** A page that broke: the administrator hears of it (Admin → Errors) and the person can try again. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const text = useText();
  useEffect(() => { const e = error instanceof Error ? error : new Error(String(error)); reportError("crash", e.message, e.stack ?? ""); }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Heading>{text("common.pageBroke")}</Heading>
      <p className="m-0 text-sm text-muted">{text("common.pageBrokeText")}</p>
      <Button onClick={retry}>{text("common.retry")}</Button>
    </div>
  );
}
