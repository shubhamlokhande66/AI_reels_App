"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/atoms/Icon";

export type MoreItem = { label: string; icon?: string; href?: string; onClick?: () => void; danger?: boolean; disabled?: boolean };

/** The "⋯" button of a page (design: the project's top bar) with its short list of actions. */
export function MoreMenu({ items, label = "More actions" }: { items: MoreItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" className="ib plain" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 top-[calc(100%+6px)] z-50 w-60 !gap-0 !p-1.5" style={{ boxShadow: "0 18px 40px -16px rgba(40,25,10,.45)" }}>
          {items.map((it) => {
            const cls = `row min-h-[44px] w-full rounded-[10px] px-2.5 text-left text-[14px] font-semibold hover:bg-surface-2 disabled:opacity-50 ${it.danger ? "text-danger" : ""}`;
            const inner = (
              <>
                {it.icon && <Icon name={it.icon} size={18} />}
                {it.label}
              </>
            );
            return it.href ? (
              <Link key={it.label} role="menuitem" href={it.href} className={cls} onClick={() => setOpen(false)}>
                {inner}
              </Link>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={cls}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
