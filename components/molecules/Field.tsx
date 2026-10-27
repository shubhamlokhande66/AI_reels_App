import { cn } from "@/lib/cn";
import { Icon } from "@/components/atoms/Icon";

/** A form field: its label above, then the control (an <Input>, <TextArea>, select…), and under it a hint, or what is
 * wrong (`error`, red) or right (`ok`, green) as the person types. */
export function Field({ label, hint, error, ok, className, children }: { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; ok?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const note = error || ok || hint;
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-[12px] font-semibold text-muted", className)}>
      {label}
      {children}
      {note && (
        <span role={error ? "alert" : undefined} className={cn("flex items-center gap-1 text-[11.5px] font-normal", error ? "font-semibold text-danger" : ok ? "font-semibold text-success" : "")}>
          {error && <Icon name="warn" size={13} className="shrink-0" />}
          {!error && ok && <Icon name="check" size={13} className="shrink-0" />}
          {note}
        </span>
      )}
    </label>
  );
}
