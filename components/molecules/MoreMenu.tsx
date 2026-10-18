"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/atoms/Icon";
import { cn } from "@/lib/cn";

/** `reload`: a full page load (Fast Studio). */
export type MoreItem = { label: string; icon?: string; href?: string; reload?: boolean; onClick?: () => void; danger?: boolean; disabled?: boolean };

const WIDTH = 240, GAP = 6, EDGE = 8;

/** The "⋯" button with its short list of actions. The list opens in a layer above the page (a portal), placed under
 * the button and kept on screen, so a card, a scrolling row or a small screen never cuts it off. */
export function MoreMenu({ items, label = "More actions" }: { items: MoreItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect(), h = menu.current?.offsetHeight ?? items.length * 44 + 12;
      const up = r.bottom + GAP + h > window.innerHeight - EDGE && r.top - GAP - h > EDGE; // no room below: open upwards
      const left = Math.min(Math.max(EDGE, r.right - WIDTH), window.innerWidth - WIDTH - EDGE);
      setPos({ top: up ? r.top - GAP - h : r.bottom + GAP, left, up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const row = (danger?: boolean) =>
    cn("flex min-h-[44px] w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[14px] font-semibold transition-colors hover:bg-surface-2 disabled:opacity-50", danger ? "text-danger" : "text-foreground");

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-surface-2"
      >
        <Icon name="more" size={20} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={label}
            className="fixed z-[95] flex flex-col rounded-2xl border border-border bg-surface p-1.5 text-foreground shadow-[0_20px_44px_-18px_rgba(0,0,0,.7)]"
            style={{ width: WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {items.map((it) => {
              const inner = (
                <>
                  {it.icon && <Icon name={it.icon} size={18} />}
                  {it.label}
                </>
              );
              if (it.href) {
                const Tag = it.reload ? "a" : Link;
                return (
                  <Tag key={it.label} role="menuitem" href={it.href} className={row(it.danger)} onClick={() => setOpen(false)}>
                    {inner}
                  </Tag>
                );
              }
              return (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  className={row(it.danger)}
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
          </div>,
          document.body,
        )}
    </>
  );
}
