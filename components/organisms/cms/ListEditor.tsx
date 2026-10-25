"use client";

import { cn } from "@/lib/cn";
import { ICON_CHOICES, newItem, TONE_CHOICES, type ListDef, type ListItem } from "@/lib/collections";
import { TONE_BG, type Tone } from "@/lib/ui";
import { Button, Card, Heading, Icon, IconButton, Input, TextArea } from "@/components/atoms";
import { Field } from "@/components/molecules/Field";

/** A list in the CMS (Home's cards, tips, questions…): every item as a card with its fields, ↑ ↓ to move it, a bin to
 * remove it, and "Add" at the end. Changes go to the CMS's draft; "Save and publish" keeps them. */
export function ListEditor({ def, items, onChange, changed, onReset }: { def: ListDef; items: ListItem[]; onChange: (items: ListItem[]) => void; changed: boolean; onReset: () => void }) {
  const set = (i: number, key: string, v: string) => onChange(items.map((it, j) => (j === i ? { ...it, [key]: v } : it)));
  const move = (i: number, d: number) => { const x = [...items]; [x[i], x[i + d]] = [x[i + d], x[i]]; onChange(x); };
  const name = (it: ListItem) => it.title || it.q || "";

  return (
    <Card as="section" aria-label={def.name} className="flex flex-col gap-3 border-accent/40">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="layers" size={16} color="var(--accent)" />
        <Heading size="section" as="h3" className="text-[14px]">{def.name}</Heading>
        <span className="text-[12px] text-muted">{items.length} of up to {def.max} · add, move or remove</span>
        {changed && <button type="button" onClick={onReset} className="ml-auto text-[11.5px] font-semibold text-muted hover:text-accent">Put the first {def.itemName}s back</button>}
      </div>

      {items.map((it, i) => (
        <div key={it.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
          <div className="flex items-center gap-2">
            {it.icon && (
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white", it.tone ? TONE_BG[it.tone as Tone] : "bg-surface")} style={it.color ? { color: it.color } : undefined}>
                <Icon name={it.icon} size={16} stroke={2} />
              </span>
            )}
            <b className="min-w-0 flex-1 truncate text-[13px] capitalize">{def.itemName} {i + 1}{name(it) ? ` · ${name(it)}` : ""}</b>
            <IconButton icon="down" size={32} iconSize={15} plain label="Move up" className="rotate-180" disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton icon="down" size={32} iconSize={15} plain label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
            <IconButton icon="trash" size={32} iconSize={15} plain label={`Remove this ${def.itemName}`} className="text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {def.fields.map((f) => {
              const v = it[f.key] ?? "", id = `ls-${def.id}-${it.id}-${f.key}`;
              const label = <span>{f.label}{f.required && <span className="text-danger"> *</span>}</span>;
              if (f.type === "long") return <Field key={f.key} label={label} className="sm:col-span-2"><TextArea id={id} value={v} onChange={(e) => set(i, f.key, e.target.value)} rows={3} /></Field>;
              if (f.type === "icon")
                return (
                  <Field key={f.key} label={label} className="sm:col-span-2">
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={f.label}>
                      {ICON_CHOICES.map((ic) => (
                        <button key={ic} type="button" role="radio" aria-checked={v === ic} title={ic} onClick={() => set(i, f.key, ic)}
                          className={cn("grid h-9 w-9 place-items-center rounded-lg border transition-colors", v === ic ? "border-accent bg-accent/15 text-accent" : "border-border bg-surface text-muted hover:text-foreground")}>
                          <Icon name={ic} size={16} />
                        </button>
                      ))}
                    </div>
                  </Field>
                );
              if (f.type === "tone")
                return (
                  <Field key={f.key} label={label} className="sm:col-span-2">
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.label}>
                      {TONE_CHOICES.map((tn) => (
                        <button key={tn} type="button" role="radio" aria-checked={v === tn} title={tn} onClick={() => set(i, f.key, tn)}
                          className={cn("h-8 w-8 rounded-full border-2 transition-transform", TONE_BG[tn as Tone], v === tn ? "scale-110 border-foreground" : "border-transparent")} />
                      ))}
                    </div>
                  </Field>
                );
              if (f.type === "color")
                return (
                  <Field key={f.key} label={label}>
                    <span className="flex items-center gap-2">
                      <input type="color" aria-label={f.label} value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#b05cff"} onChange={(e) => set(i, f.key, e.target.value)} className="h-11 w-12 cursor-pointer rounded-lg border border-border bg-surface" />
                      <Input id={id} value={v} onChange={(e) => set(i, f.key, e.target.value)} placeholder="#b05cff" />
                    </span>
                  </Field>
                );
              return (
                <Field key={f.key} label={label} hint={f.hint} className={f.type === "link" ? "sm:col-span-2" : undefined}>
                  <Input id={id} value={v} onChange={(e) => set(i, f.key, e.target.value)} placeholder={f.type === "link" ? "/create/music" : undefined} />
                </Field>
              );
            })}
          </div>
        </div>
      ))}

      {!items.length && <p className="m-0 rounded-xl border border-dashed border-border py-6 text-center text-[12.5px] text-muted">No {def.itemName}s yet.</p>}
      <Button variant="secondary" icon="plus" disabled={items.length >= def.max} onClick={() => onChange([...items, newItem(def)])} className="self-start capitalize">
        Add {def.itemName}
      </Button>
    </Card>
  );
}
