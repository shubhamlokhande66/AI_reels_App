import Link from "next/link";
import type { ProjectStatus } from "@/types/api";

const STATUS_STYLE: Record<ProjectStatus, string> = {
  draft: "border border-border bg-surface-2 text-muted",
  processing: "border border-accent/40 bg-accent/10 text-accent",
  completed: "border border-success/30 bg-success/10 text-success",
  failed: "border border-danger/40 bg-danger/10 text-danger",
};
const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] ${STATUS_STYLE[status]}`}>
      {status === "processing" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`lux-card lux-enter rounded-3xl p-6 transition-colors ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="lux-eyebrow">AI Reel Studio</p>
          <h1 className="mt-1 font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="lux-hairline mt-6" />
    </div>
  );
}

const BTN = "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold tracking-wide transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45";
export const btnPrimary = `${BTN} lux-btn-gold`;
export const btnSecondary = `${BTN} border border-border bg-surface-2/70 text-foreground hover:border-accent/60 hover:text-accent`;
export const btnDanger = `${BTN} border border-danger/40 text-danger hover:bg-danger/10`;

export function LinkButton({ href, children, primary = true }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <Link href={href} className={primary ? btnPrimary : btnSecondary}>
      {children}
    </Link>
  );
}

export function ErrorBanner({ title, message, code, onRetry }: { title?: string; message: string; code?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="lux-enter rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm">
      <p className="font-medium text-danger">{title ?? "Something went wrong"}</p>
      <p className="mt-1 text-foreground/90">{message}</p>
      {code && <p className="mt-1 font-mono text-xs text-muted">{code}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${btnSecondary} mt-3`}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="lux-enter rounded-3xl border border-dashed border-accent/25 p-12 text-center">
      <p className="font-display text-2xl">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-sm text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
      {label}
    </div>
  );
}
