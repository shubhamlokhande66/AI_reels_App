"use client";

import { useRef, useState } from "react";

/** Drag-and-drop ordering for a list or a grid, with a mouse or a finger (pointer events: the browser's own drag does
 * not work on phones). Put `item(i)` on each item and `handle(i)` on its grip; while dragging, the item moves to where
 * the pointer is (`move(from, to)` is called at each step), and `dragging` is the index being dragged. */
export function useDragSort(move: (from: number, to: number) => void) {
  const at = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const end = () => { at.current = null; setDragging(null); };
  return {
    dragging,
    item: (i: number) => ({ "data-sort": i }),
    handle: (i: number) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        at.current = i;
        setDragging(i);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (at.current === null) return;
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-sort]");
        const to = over ? Number(over.dataset.sort) : NaN;
        if (Number.isInteger(to) && to !== at.current) { move(at.current, to); at.current = to; setDragging(to); }
      },
      onPointerUp: end,
      onPointerCancel: end,
      style: { touchAction: "none" as const },
      "aria-roledescription": "drag handle",
    }),
  };
}

/** a list with one item moved (from → to), for move() */
export const moved = <T,>(list: T[], from: number, to: number) => { const x = [...list]; const [it] = x.splice(from, 1); x.splice(to, 0, it); return x; };
