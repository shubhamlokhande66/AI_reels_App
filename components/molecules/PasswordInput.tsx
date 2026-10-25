"use client";

import { forwardRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/atoms/Icon";
import { Input } from "@/components/atoms/Input";
import { useT } from "@/hooks/useApi";

/** A password box with the eye: a tap shows what is typed, another hides it again. `invalid`: drawn in red. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { invalid?: boolean }>(function PasswordInput({ className, invalid, ...rest }, ref) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <span className="relative flex">
      <Input ref={ref} type={show ? "text" : "password"} aria-invalid={invalid || undefined} className={cn("pr-11", invalid && "border-danger focus:border-danger", className)} {...rest} />
      <button type="button" onClick={(e) => { e.preventDefault(); setShow((v) => !v); }} aria-label={t(show ? "auth.hidePassword" : "auth.showPassword")} title={t(show ? "auth.hidePassword" : "auth.showPassword")}
        aria-pressed={show} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted transition-colors hover:text-foreground">
        <Icon name={show ? "eyeOff" : "eye"} size={18} />
      </button>
    </span>
  );
});
