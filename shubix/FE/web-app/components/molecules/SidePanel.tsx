"use client";

import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { Heading } from "@/components/atoms/Heading";
import { IconButton } from "@/components/atoms/IconButton";

/** A form that slides in from the right over a dimmed page (the CMS's section, a template): its title and where it
 * is, the content (scrolls), and its buttons at the bottom. Closes with ✕, Esc or a tap outside. */
export function SidePanel({ open, onClose, title, where, badge, footer, wide = false, children }: { open: boolean; onClose: () => void; title: string; where?: string; badge?: React.ReactNode; footer?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn("absolute inset-y-0 right-0 flex w-full animate-sheet flex-col border-l border-border bg-background shadow-2xl", wide ? "max-w-[860px]" : "max-w-[680px]")}>
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            {where && <p className="m-0 truncate text-[12px] text-muted">{where}</p>}
            <Heading className="truncate">{title}</Heading>
          </div>
          {badge}
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface-2/40 p-4 md:p-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t border-border bg-[var(--bar)] px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}
