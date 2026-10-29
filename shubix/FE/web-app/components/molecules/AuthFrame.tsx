"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { LogoTile } from "@/components/atoms/Logo";
import { useT } from "@/hooks/useApi";

/** The sign-in pages' frame (design: Forgot): back to sign in, the brand, then the card. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[420px] flex-col gap-4 px-6 py-7">
      <Link href="/login" className="flex items-center gap-2 text-[12.5px] font-bold text-muted hover:text-foreground">
        <Icon name="back" size={18} />
        {t("auth.back")}
      </Link>
      <div className="flex justify-center">
        <LogoTile height={56} />
      </div>
      {children}
    </div>
  );
}
