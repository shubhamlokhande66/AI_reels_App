"use client";

import { useDragReorder } from "@/lib/dragReorder";
import type { Media } from "@/types/api";

/** Already-uploaded clips, numbered: drag a clip to any position (e.g. make it 1, 2, 5, …), or use ↑ / ↓. */
export function ClipOrderList({ videos, order, onChange, disabled }: { videos: Media[]; order: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const ids = order.filter((id) => byId.has(id));
  const { itemProps, dragIndex, overIndex } = useDragReorder(ids, onChange, disabled);

  function move(index: number, delta: -1 | 1) {
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  }

  if (ids.length === 0) return null;
  return (
    <ol aria-label="Clip order" className="space-y-1.5">
      <p className="text-xs text-muted">Drag a clip to any spot, or use ↑ / ↓.</p>
      {ids.map((id, i) => {
        const v = byId.get(id)!;
        return (
          <li
            key={id}
            {...itemProps(i)}
            className={`flex items-center gap-2 rounded-lg border bg-surface px-2 py-1.5 text-sm transition-opacity ${
              overIndex === i ? "border-accent" : "border-border"
            } ${dragIndex === i ? "opacity-40" : ""} ${disabled ? "" : "cursor-grab active:cursor-grabbing"}`}
          >
            <span className="w-5 shrink-0 text-right tabular-nums text-muted">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate" title={v.name}>
              {v.name}
            </span>
            <button
              type="button"
              disabled={disabled || i === 0}
              onClick={() => move(i, -1)}
              aria-label={`Move ${v.name} up`}
              className="rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/60 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={disabled || i === ids.length - 1}
              onClick={() => move(i, 1)}
              aria-label={`Move ${v.name} down`}
              className="rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/60 disabled:opacity-40"
            >
              ↓
            </button>
          </li>
        );
      })}
    </ol>
  );
}
