"use client";

import { Button, Heading } from "@/components/atoms";
import { useText } from "@/hooks/useApi";

/** A link that leads nowhere: say so kindly and offer the two places people usually want. */
export function NotFoundView() {
  const text = useText();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-16 text-center">
      <span className="font-[family-name:var(--font-geist-mono)] text-[44px] leading-none text-accent">404</span>
      <Heading size="page">{text("notFound.title")}</Heading>
      <p className="m-0 text-[12.5px] text-muted">{text("notFound.text")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button href="/">{text("notFound.home")}</Button>
        <Button href="/create/music" reload variant="secondary">{text("notFound.make")}</Button>
      </div>
    </div>
  );
}
