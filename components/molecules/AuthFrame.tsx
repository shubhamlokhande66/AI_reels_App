import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import { LogoTile } from "@/components/atoms/Logo";

/** The sign-in pages' frame (design: Forgot): back to sign in, the brand, then the card. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[420px] flex-col gap-4 px-6 py-7">
      <Link href="/login" className="row mu sm font-bold">
        <Icon name="back" size={18} />
        Back to sign in
      </Link>
      <div className="flex justify-center">
        <LogoTile height={56} />
      </div>
      {children}
    </div>
  );
}
