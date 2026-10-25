import { forwardRef } from "react";
import { cn } from "@/lib/cn";

/** The app's text box and text area, one look everywhere (Tailwind; was the .inp / .ta classes). */
const FIELD = "w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-[14px] font-medium text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(FIELD, "h-11", className)} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(FIELD, "min-h-[88px] resize-y py-2.5 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn(FIELD, "h-11 cursor-pointer", className)} {...rest}>{children}</select>;
});
