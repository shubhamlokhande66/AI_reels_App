import { cn } from "@/lib/cn";
import { Icon } from "@/components/atoms/Icon";

/** A search field with its magnifier (Templates, the computers' header, the admin's Texts). `label` is for screen
 * readers; the placeholder shows it too unless one is given. */
export function SearchBox({ value, onChange, label, placeholder, className, inputClassName, ...rest }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string; inputClassName?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">) {
  return (
    <label className={cn("flex h-11 w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-muted transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)]", className)}>
      <Icon name="search" size={17} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? label} aria-label={label} className={cn("h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted", inputClassName)} {...rest} />
    </label>
  );
}
