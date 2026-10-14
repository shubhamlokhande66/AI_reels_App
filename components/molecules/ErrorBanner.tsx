import { btnSecondary } from "@/components/atoms";

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
