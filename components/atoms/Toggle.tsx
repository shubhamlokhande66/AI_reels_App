"use client";

/** An on / off switch row (design: a label and a gold toggle). */
export function Toggle({ label, hint, on, onChange, disabled }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="between sm">
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="mu xs block">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="tog disabled:opacity-50" onClick={() => onChange(!on)}>
        <i />
      </button>
    </div>
  );
}
