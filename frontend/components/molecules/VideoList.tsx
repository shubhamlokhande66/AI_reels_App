"use client";

import { useEffect, useMemo } from "react";
import { useDragReorder } from "@/lib/dragReorder";
import { formatBytes } from "@/lib/format";

export interface LocalVideo {
  key: string;
  file: File;
}

interface Props {
  items: LocalVideo[];
  onChange: (items: LocalVideo[]) => void;
  disabled?: boolean;
}

/** Local (pre-upload) clips with a real first-frame preview: drag to reorder (or the ↑ / ↓ buttons), and remove. */
export function VideoList({ items, onChange, disabled }: Props) {
  const urls = useMemo(() => new Map(items.map((i) => [i.key, URL.createObjectURL(i.file)])), [items]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const { itemProps, dragIndex, overIndex } = useDragReorder(items, onChange, disabled);

  function move(index: number, delta: -1 | 1) {
    const next = [...items];
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  }

  if (items.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Selected videos">
      {items.map((item, i) => (
        <li
          key={item.key}
          {...itemProps(i)}
          className={`overflow-hidden rounded-2xl border bg-surface transition-opacity ${
            overIndex === i ? "border-accent" : "border-border"
          } ${dragIndex === i ? "opacity-40" : ""} ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
        >
          <video
            src={`${urls.get(item.key)}#t=0.5`}
            preload="metadata"
            muted
            playsInline
            className="aspect-video w-full bg-black object-cover"
            aria-label={`Preview of ${item.file.name}`}
          />
          <div className="p-3">
            <p className="truncate text-sm font-medium" title={item.file.name}>
              {i + 1}. {item.file.name}
            </p>
            <p className="text-xs text-muted">{formatBytes(item.file.size)}</p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
                aria-label={`Move ${item.file.name} up`}
                className="rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/60 disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || i === items.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move ${item.file.name} down`}
                className="rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/60 disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(items.filter((x) => x.key !== item.key))}
                aria-label={`Remove ${item.file.name}`}
                className="ml-auto rounded-lg border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
