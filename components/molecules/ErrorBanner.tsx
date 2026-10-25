"use client";

import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Icon } from "@/components/atoms/Icon";
import { useT } from "@/hooks/useApi";

/** The design's error card: what went wrong in plain words, and Try again. */
export function ErrorBanner({ title, message, code, onRetry }: { title?: string; message: string; code?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <Card role="alert" className="flex gap-2.5 border-[color-mix(in_srgb,var(--danger)_35%,var(--border))]">
      <span className="mt-0.5 text-danger">
        <Icon name="warn" size={20} />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <b className="text-danger">{title ?? t("common.error")}</b>
        <p className="m-0 mt-0.5 text-muted">{message}</p>
        {code && <p className="m-0 mt-1 font-[family-name:var(--font-geist-mono)] text-[11px] text-muted">{code}</p>}
        {onRetry && <Button variant="secondary" size="sm" className="mt-2.5" onClick={onRetry}>{t("common.retry")}</Button>}
      </div>
    </Card>
  );
}
