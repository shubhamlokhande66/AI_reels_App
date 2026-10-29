"use client";

import { Button } from "@/components/atoms/Button";
import { Card } from "@/components/atoms/Card";
import { Icon } from "@/components/atoms/Icon";
import { useT } from "@/hooks/useApi";

/** The design's error card: what went wrong in plain words, and Try again. */
export function ErrorBanner({ title, message, code, onRetry }: { title?: string; message: string; code?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <Card role="alert" className="relative flex gap-3 overflow-hidden !rounded-[18px] !border-[color-mix(in_srgb,var(--danger)_28%,var(--line))] !bg-[linear-gradient(110deg,color-mix(in_srgb,var(--danger)_7%,var(--surface)),var(--surface)_68%)] shadow-[0_16px_38px_-30px_color-mix(in_srgb,var(--danger)_40%,transparent)]">
      <span aria-hidden className="pointer-events-none absolute -right-7 -top-10 h-24 w-24 rounded-full bg-danger/8 blur-2xl" />
      <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-danger/20 bg-danger/10 text-danger">
        <Icon name="warn" size={18} />
      </span>
      <div className="relative min-w-0 flex-1 text-[13px] leading-relaxed">
        <b className="text-danger">{title ?? t("common.error")}</b>
        <p className="m-0 mt-1 text-muted">{message}</p>
        {code && <p className="m-0 mt-1 font-[family-name:var(--font-geist-mono)] text-[11px] text-muted">{code}</p>}
        {onRetry && <Button variant="secondary" size="sm" className="mt-2.5" onClick={onRetry}>{t("common.retry")}</Button>}
      </div>
    </Card>
  );
}
