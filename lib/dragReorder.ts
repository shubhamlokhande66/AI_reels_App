"use client";

import { useState } from "react";

/**
 * Drag-and-drop reordering for a list, e.g. drag clip 5 to position 2. Plain HTML5 drag events, no library.
 * Spread `itemProps(index)` onto each row's draggable element; `overIndex` is which row is the current drop target (for a style hint).
 */
export function useDragReorder<T>(items: T[], onChange: (next: T[]) => void, disabled?: boolean) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function itemProps(index: number) {
    if (disabled) return {};
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setDragIndex(index);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnter: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragIndex !== null && dragIndex !== index) setOverIndex(index);
      },
      onDragOver: (e: React.DragEvent) => e.preventDefault(), // required to allow dropping
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === index) return;
        const next = [...items];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(index, 0, moved);
        onChange(next);
        setDragIndex(null);
        setOverIndex(null);
      },
      onDragEnd: () => {
        setDragIndex(null);
        setOverIndex(null);
      },
    };
  }

  return { itemProps, dragIndex, overIndex };
}
