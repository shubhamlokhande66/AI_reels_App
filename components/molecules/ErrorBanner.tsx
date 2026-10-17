import { btnSecondary } from "@/components/atoms";
import { Icon } from "@/components/atoms/Icon";

/** The design's error card: what went wrong in plain words, and Try again. */
export function ErrorBanner({ title, message, code, onRetry }: { title?: string; message: string; code?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="card lux-enter" style={{ flexDirection: "row", gap: 10, borderColor: "color-mix(in srgb, var(--danger) 35%, var(--border))" }}>
      <span className="mt-0.5 text-danger">
        <Icon name="warn" size={20} />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <b className="text-danger">{title ?? "Something went wrong"}</b>
        <p className="mu mt-0.5">{message}</p>
        {code && <p className="mono xs mu mt-1">{code}</p>}
        {onRetry && (
          <button type="button" onClick={onRetry} className={`${btnSecondary} sm mt-2.5`}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
