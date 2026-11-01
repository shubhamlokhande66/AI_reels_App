"use client";

import { Chip, ChipRow } from "@/components/atoms/Chip";

/** Tabs drawn as chips (My Reels: Drafts / Saved; the template filters). */
export function ChipTabs<K extends string>({ items, value, onChange, label, className }: { items: readonly { id: K; label: React.ReactNode }[]; value: K; onChange: (id: K) => void; label: string; className?: string }) {
  return (
    <ChipRow role="tablist" aria-label={label} className={className}>
      {items.map((it) => (
        <Chip key={it.id} role="tab" aria-selected={value === it.id} on={value === it.id} onClick={() => onChange(it.id)}>
          {it.label}
        </Chip>
      ))}
    </ChipRow>
  );
}
