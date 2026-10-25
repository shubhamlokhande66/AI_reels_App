"use client";

import { useState } from "react";
import { moved, useDragSort } from "@/lib/useDragSort";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, Chip, ChipRow, Heading, Icon, IconButton, Input, Select, Spinner, Toggle } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field, SearchBox, Segmented, SidePanel } from "@/components/molecules";
import { PLANS, PLAN_NAME } from "@/lib/plan-locks";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { StatTile } from "@/components/molecules/StatTile";
import { TemplateCard } from "@/components/molecules/TemplateCard";
import {
  edgeAt, groupsOf, isLive, todayIST, TPL_ANIMS, TPL_BGS, TPL_CAP_STYLES, TPL_LIMITS, TPL_LOOKS, TPL_MODES, TPL_MUSIC, TPL_PACES, TPL_TEXT_STYLES, TPL_KINDS,
  type StudioTemplate, type TplKind, type TplEdge, type TplText,
} from "@/lib/studio-templates";

/** Admin → Templates: every template of Fast Studio, managed here. A card per template (its poster, status, group,
 * show on/off, move, copy, delete); a tap opens its editor on the right: the song's length, the look, the texts with
 * the times they show on the Reel, and the days a template shows (a festival's week). Saved for everyone at once; the
 * app reads them from the server, no update needed. */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const blank = (n: number): StudioTemplate => ({ id: `new-${n}`, name: "New template", kind: "music", len: 15, text: "", group: "Everyday", on: false, edit: { look: "vivid", mode: "auto", style: "pop", texts: [] } });
const opts = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => <option key={k} value={k}>{v}</option>);
const status = (t: StudioTemplate, day: string): { label: string; tone: "success" | "neutral" | "brand" | "danger" } =>
  !t.on ? { label: "Hidden", tone: "neutral" } : isLive(t, day) ? { label: "Live", tone: "success" } : t.showFrom && day < t.showFrom ? { label: `From ${t.showFrom}`, tone: "brand" } : { label: "Ended", tone: "danger" };
const PLAN_OPTIONS = PLANS.map((p) => ({ value: p, label: PLAN_NAME[p] }));
const CARD_PLANS = PLAN_OPTIONS.filter((o) => o.value !== "business"); // on the card: Free · Editor · Pro
const DOT = { success: "bg-success", neutral: "bg-white/60", brand: "bg-accent", danger: "bg-danger" } as const;
const kindOf = (t: StudioTemplate) => (t.kind === "talk" ? "Talking" : `${t.kind === "photo" ? "Photos" : "Music"} · ${t.len ?? ""} s`);

export function TemplatesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-templates"], queryFn: api.adminTemplates });
  // the changes not saved yet (null: none, the server's list is shown)
  const [draft, setDraft] = useState<StudioTemplate[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [find, setFind] = useState("");
  const [group, setGroup] = useState("all");
  const list = draft ?? q.data?.templates ?? null, dirty = draft !== null;
  // drag and drop: the order people see
  const sort = useDragSort((from, to) => {
    setDraft((d) => moved(d ?? q.data?.templates ?? [], from, to));
    setOpen((o) => (o === from ? to : o));
    setMsg("");
  });
  const save = useMutation({ mutationFn: api.setTemplates, onSuccess: (r) => { qc.setQueryData(["admin-templates"], r); setDraft(null); setMsg("✓ Saved: people see the new templates now."); } });
  const reset = useMutation({ mutationFn: api.resetTemplates, onSuccess: (r) => { qc.setQueryData(["admin-templates"], r); setDraft(null); setOpen(null); setMsg("Back to the default templates."); } });
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!list) return <Spinner label="Loading templates…" />;

  const day = todayIST();
  const edit = (fn: (l: StudioTemplate[]) => void) => { const l = clone(list); fn(l); setDraft(l); setMsg(""); };
  const copy = (i: number) => edit((l) => { const c = clone(l[i]); c.id = `${c.id}-copy`.slice(0, 40); c.name = `${c.name} copy`.slice(0, TPL_LIMITS.name); c.on = false; l.splice(i + 1, 0, c); setOpen(i + 1); });
  const remove = async (i: number) => { if (await confirmAction({ title: `Delete “${list[i].name}”?`, body: "It is gone once you save for everyone.", ok: "Delete", danger: true })) edit((l) => { l.splice(i, 1); setOpen(null); }); };
  const live = list.filter((t) => isLive(t, day)).length, hidden = list.filter((t) => !t.on).length, groups = groupsOf(list);
  const needle = find.trim().toLowerCase();
  const shown = list.map((t, i) => ({ t, i })).filter(({ t }) => (group === "all" || t.group === group) && (!needle || `${t.name} ${t.group} ${t.text}`.toLowerCase().includes(needle)));
  const cur = open !== null ? list[open] : null;

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon="grid" label="Templates" value={list.length} />
        <StatTile icon="eye" label="Live today" value={live} note={`India time, ${day}`} />
        <StatTile icon="lock" label="Hidden" value={hidden} />
        <StatTile icon="layers" label="Groups" value={groups.length} />
      </div>

      <Card className="flex flex-col gap-3 p-3 md:p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchBox value={find} onChange={setFind} label="Search templates" className="h-10 sm:max-w-xs" />
          <span className="text-[12.5px] text-muted sm:ml-2">Drag a card by its ⠿ to change the order people see (Home shows the first 6).</span>
          <Button size="sm" icon="plus" className="h-10 sm:ml-auto" onClick={() => edit((l) => { l.push(blank(l.length + 1)); setOpen(l.length - 1); })}>New template</Button>
        </div>
        <ChipRow role="radiogroup" aria-label="Group">
          {["all", ...groups].map((g) => (
            <Chip key={g} role="radio" aria-checked={group === g} on={group === g} onClick={() => setGroup(g)}>
              {g === "all" ? "All" : g}<span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{g === "all" ? list.length : list.filter((t) => t.group === g).length}</span>
            </Chip>
          ))}
        </ChipRow>
      </Card>

      {!shown.length ? (
        <EmptyState icon="grid" title="No template matches" hint="Try another word or group, or make a new template." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
          {shown.map(({ t, i }) => {
            const s = status(t, day), plan = t.plan ?? "free";
            return (
              <Card key={t.id} as="article" {...sort.item(i)}
                className={cn("flex flex-col gap-2.5 p-2.5 transition-[opacity,box-shadow] md:p-2.5", !t.on && "opacity-75", sort.dragging === i && "z-10 scale-[1.02] border-accent opacity-90 shadow-[0_18px_40px_-20px_var(--brand-glow)]")}>
                <div className="relative">
                  <button type="button" onClick={() => setOpen(i)} className="block w-full text-left" aria-label={`Edit ${t.name}`}>
                    <TemplateCard t={t} compact link={false} />
                  </button>
                  <span className="pointer-events-none absolute left-2 top-2"><Badge tone="dark"><span className={cn("h-1.5 w-1.5 rounded-full", DOT[s.tone])} />{s.label}</Badge></span>
                  {/* drag it by its grip to change the order people see */}
                  <button type="button" {...sort.handle(i)} aria-label={`Drag ${t.name} to move it (now #${i + 1})`} title="Drag to move"
                    className="absolute right-2 top-2 inline-flex cursor-grab items-center gap-1 rounded-full bg-black/60 py-1 pl-1.5 pr-2 text-[11px] font-bold text-white active:cursor-grabbing">
                    <Icon name="grip" size={14} />#{i + 1}
                  </button>
                </div>
                <button type="button" onClick={() => setOpen(i)} className="min-w-0 text-left">
                  <b className="block truncate text-[13.5px] hover:text-accent">{t.name}</b>
                  <span className="block truncate text-[11.5px] text-muted">{t.group} · {kindOf(t)}</span>
                </button>
                {/* who can use it, right here */}
                <Segmented size="sm" label={`${t.name}: plan`} className="w-full [&>button]:flex-1" options={plan === "business" ? PLAN_OPTIONS : CARD_PLANS} value={plan}
                  onChange={(v) => edit((l) => { if (v === "free") delete l[i].plan; else l[i].plan = v; })} />
                <Toggle label="Show" on={t.on} onChange={(v) => edit((l) => { l[i].on = v; })} />
                <div className="flex items-center gap-1 border-t border-border pt-2">
                  <IconButton icon="copy" size={32} iconSize={15} plain label="Copy" onClick={() => copy(i)} />
                  <IconButton icon="pen" size={32} iconSize={15} plain label="Edit" onClick={() => setOpen(i)} />
                  <IconButton icon="trash" size={32} iconSize={15} plain label="Delete" className="ml-auto text-danger" onClick={() => void remove(i)} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* save */}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-[var(--bar)] px-4 py-3 shadow-[var(--shadow)] backdrop-blur">
        {save.error ? <span className="mr-auto text-[13px] text-danger">{errorMessage(save.error)}</span>
          : <span className={cn("mr-auto text-[13px]", dirty ? "font-bold text-warning" : msg ? "text-success" : "hidden text-muted sm:inline")}>{dirty ? "Changes not saved yet" : msg || (q.data?.saved ? "All saved" : "The default templates (nothing saved yet)")}</span>}
        {dirty && <Button variant="secondary" onClick={() => { setDraft(null); setOpen(null); }}>Undo changes</Button>}
        <Button variant="ghost" disabled={reset.isPending} onClick={async () => { if (await confirmAction({ title: "Go back to the default templates?", body: "Every change and every template you added is thrown away.", ok: "Back to defaults", danger: true })) reset.mutate(); }}>Defaults</Button>
        <Button icon="check" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(list)}>Save for everyone</Button>
      </div>

      {/* the template's editor, on the right */}
      <SidePanel open={!!cur} onClose={() => setOpen(null)} wide title={cur?.name || "Template"} where={cur ? `Templates › ${cur.group}` : undefined}
        badge={cur ? <Badge tone={status(cur, day).tone}>{status(cur, day).label}</Badge> : undefined}
        footer={<>
          <span className={cn("mr-auto text-[12.5px]", dirty ? "font-bold text-warning" : "text-muted")}>{dirty ? "Changes not saved yet" : "All saved"}</span>
          <Button variant="secondary" onClick={() => setOpen(null)}>Done</Button>
          <Button icon="check" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(list)}>Save for everyone</Button>
        </>}>
        {cur && open !== null && <Editor t={cur} groups={groups} set={(fn) => edit((l) => fn(l[open]))} />}
      </SidePanel>
    </div>
  );
}

const num = (v: string, d?: number) => (v.trim() === "" || !Number.isFinite(+v) ? d : +v);

function Editor({ t, groups, set }: { t: StudioTemplate; groups: string[]; set: (fn: (t: StudioTemplate) => void) => void }) {
  const e = t.edit, L = t.len ?? 30, texts = e.texts ?? [];
  const setText = (k: number, fn: (x: TplText) => void) => set((x) => { fn((x.edit.texts ??= [])[k]); });
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_170px]">
      <div className="flex min-w-0 flex-col gap-3">
        <Card as="section" aria-label="About" className="flex flex-col gap-3">
          <Heading size="section" as="h3" className="text-[14px]">About</Heading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={t.name} maxLength={TPL_LIMITS.name} onChange={(v) => set((x) => { x.name = v.target.value; })} /></Field>
            <Field label="Group">
              <Input list="tpl-groups" value={t.group} maxLength={30} onChange={(v) => set((x) => { x.group = v.target.value; })} />
              <datalist id="tpl-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </Field>
            <Field label="What it does (on the card)" className="sm:col-span-2"><Input value={t.text} maxLength={TPL_LIMITS.text} onChange={(v) => set((x) => { x.text = v.target.value; })} /></Field>
            <Field label="Id (in the link, small letters)" hint="Change it only for a new template"><Input value={t.id} maxLength={40} onChange={(v) => set((x) => { x.id = v.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"); })} /></Field>
            <Field label="Cover picture (optional)" hint="/templates/name.webp or https://…"><Input value={t.cover ?? ""} onChange={(v) => set((x) => { x.cover = v.target.value || undefined; })} /></Field>
          </div>
          <Field label="Who can use it" hint={t.plan && t.plan !== "free" ? `People below ${PLAN_NAME[t.plan]} see the Upgrade tag; a tap opens the plans.` : "Everyone, on every plan."}>
            <Segmented label="Plan" options={PLAN_OPTIONS} value={t.plan ?? "free"} onChange={(v) => set((x) => { if (v === "free") delete x.plan; else x.plan = v; })} />
          </Field>
          <div className="grid gap-2.5 rounded-xl border border-border bg-surface-2/50 p-3 sm:grid-cols-2">
            <Toggle label="Show to people" on={t.on} onChange={(v) => set((x) => { x.on = v; })} />
            <Toggle label="“New” badge" on={!!t.isNew} onChange={(v) => set((x) => { x.isNew = v; })} />
          </div>
        </Card>

        <Card as="section" aria-label="The edit" className="flex flex-col gap-3">
          <Heading size="section" as="h3" className="text-[14px]">The edit</Heading>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind">
              <Select value={t.kind} onChange={(v) => set((x) => { x.kind = v.target.value as TplKind; if (x.kind === "talk") { delete x.len; x.edit.pace ??= "natural"; x.edit.music ??= 0.05; x.edit.caps ??= true; } else x.len ??= 15; })}>{opts(TPL_KINDS)}</Select>
            </Field>
            {t.kind !== "talk" && <Field label="Length of the song (seconds)"><Input type="number" min={5} max={180} value={t.len ?? ""} onChange={(v) => set((x) => { x.len = num(v.target.value) && Math.round(num(v.target.value)!); })} /></Field>}
            <Field label="Look"><Select value={e.look} onChange={(v) => set((x) => { x.edit.look = v.target.value as never; })}>{opts(TPL_LOOKS)}</Select></Field>
            {t.kind !== "talk" ? (
              <Field label="Cutting"><Select value={e.mode ?? "auto"} onChange={(v) => set((x) => { x.edit.mode = v.target.value as never; })}>{opts(TPL_MODES)}</Select></Field>
            ) : (
              <>
                <Field label="Pauses cut"><Select value={e.pace ?? "natural"} onChange={(v) => set((x) => { x.edit.pace = v.target.value as never; })}>{opts(TPL_PACES)}</Select></Field>
                <Field label="Music under the voice"><Select value={String(e.music ?? 0.05)} onChange={(v) => set((x) => { x.edit.music = +v.target.value; })}>{TPL_MUSIC.map((m) => <option key={m} value={m}>{m === 0 ? "None" : `${Math.round(m * 100)}%`}</option>)}</Select></Field>
              </>
            )}
            <Field label="Captions style"><Select value={e.style ?? "pop"} onChange={(v) => set((x) => { x.edit.style = v.target.value as never; })}>{opts(TPL_CAP_STYLES)}</Select></Field>
            <Field label="Background"><Select value={e.bg ?? "none"} onChange={(v) => set((x) => { x.edit.bg = v.target.value as never; })}>{opts(TPL_BGS)}</Select></Field>
            <Field label="Hook text of the opener (optional)" className="sm:col-span-2"><Input value={e.hook ?? ""} maxLength={TPL_LIMITS.line} onChange={(v) => set((x) => { x.edit.hook = v.target.value || undefined; })} /></Field>
          </div>
          <div className="rounded-xl border border-border bg-surface-2/50 p-3"><Toggle label="Captions on" on={!!e.caps} onChange={(v) => set((x) => { x.edit.caps = v; })} /></div>
        </Card>

        <Card as="section" aria-label="When it shows" className="flex flex-col gap-3">
          <div><Heading size="section" as="h3" className="text-[14px]">When it shows</Heading><p className="m-0 text-[12px] text-muted">Empty: every day. Dates are India time (a festival&apos;s week).</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Show from"><Input type="date" value={t.showFrom ?? ""} onChange={(v) => set((x) => { x.showFrom = v.target.value || undefined; })} /></Field>
            <Field label="Show until"><Input type="date" value={t.showTo ?? ""} onChange={(v) => set((x) => { x.showTo = v.target.value || undefined; })} /></Field>
          </div>
        </Card>

        <Card as="section" aria-label="Texts on the Reel" className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1"><Heading size="section" as="h3" className="text-[14px]">Texts on the Reel</Heading><p className="m-0 text-[12px] text-muted">{texts.length} of up to {TPL_LIMITS.texts}. The person can change everything after.</p></div>
            <Button size="sm" variant="secondary" icon="plus" disabled={texts.length >= TPL_LIMITS.texts} onClick={() => set((x) => { (x.edit.texts ??= []).push({ text: "Your text", style: "box", color: "#FFD54A", y: 0.25, from: { p: 0, s: 0 }, to: { p: 0, s: 3 } }); })}>Add text</Button>
          </div>
          {texts.map((x, k) => (
            <div key={k} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 shrink-0 rounded-full border border-border" style={{ background: x.color }} />
                <b className="min-w-0 flex-1 truncate text-[13px]">Text {k + 1} · {x.text}</b>
                <IconButton icon="down" size={30} iconSize={14} plain label="Move earlier" className="rotate-180" disabled={k === 0} onClick={() => set((y) => { const a = y.edit.texts!; [a[k - 1], a[k]] = [a[k], a[k - 1]]; })} />
                <IconButton icon="trash" size={30} iconSize={14} plain label="Delete this text" className="text-danger" onClick={() => set((y) => { y.edit.texts!.splice(k, 1); })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Text" className="sm:col-span-2"><Input value={x.text} maxLength={TPL_LIMITS.line} onChange={(v) => setText(k, (y) => { y.text = v.target.value; })} /></Field>
                <Field label="Style"><Select value={x.style} onChange={(v) => setText(k, (y) => { y.style = v.target.value as never; })}>{opts(TPL_TEXT_STYLES)}</Select></Field>
                <Field label="Animation"><Select value={x.anim ?? "pop"} onChange={(v) => setText(k, (y) => { y.anim = v.target.value as never; })}>{opts(TPL_ANIMS)}</Select></Field>
                <Field label="Colour">
                  <span className="flex items-center gap-2">
                    <input type="color" aria-label="Colour" value={x.color} onChange={(v) => setText(k, (y) => { y.color = v.target.value.toUpperCase(); })} className="h-11 w-12 cursor-pointer rounded-lg border border-border bg-surface" />
                    <Input value={x.color} onChange={(v) => setText(k, (y) => { y.color = v.target.value.toUpperCase(); })} />
                  </span>
                </Field>
                <Field label="When it shows">
                  <Select value={x.all ? "all" : "span"} onChange={(v) => setText(k, (y) => { y.all = v.target.value === "all"; if (!y.all) { y.from ??= { p: 0, s: 0 }; y.to ??= { p: 1, s: 0 }; } })}>
                    <option value="all">The whole Reel</option><option value="span">From … to …</option>
                  </Select>
                </Field>
                <Field label={`Height on screen: ${Math.round(x.y * 100)}% from the top`}><input type="range" min={3} max={97} value={Math.round(x.y * 100)} onChange={(v) => setText(k, (y) => { y.y = +v.target.value / 100; })} className="h-11 accent-[var(--accent)]" /></Field>
                <Field label={`Size: ${(x.size ?? 1).toFixed(2)}×`}><input type="range" min={30} max={300} step={5} value={Math.round((x.size ?? 1) * 100)} onChange={(v) => setText(k, (y) => { y.size = +v.target.value / 100; })} className="h-11 accent-[var(--accent)]" /></Field>
              </div>
              {!x.all && (
                <div className="flex flex-col gap-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <EdgeIn label="Starts" e={x.from ?? { p: 0, s: 0 }} on={(v) => setText(k, (y) => { y.from = v; })} />
                    <EdgeIn label="Ends" e={x.to ?? { p: 1, s: 0 }} on={(v) => setText(k, (y) => { y.to = v; })} />
                  </div>
                  <span className="text-[12px] text-muted">
                    {t.kind === "talk" ? "On a 30 s Reel" : `On this ${L} s Reel`}: {edgeAt(x.from, L, 0).toFixed(1)}–{edgeAt(x.to, L, L).toFixed(1)} s
                    {edgeAt(x.from, L, 0) >= edgeAt(x.to, L, L) && <b className="text-danger"> · ends before it starts</b>}
                  </span>
                </div>
              )}
            </div>
          ))}
          <p className="m-0 text-[12px] text-muted">Times follow the Reel&apos;s length: “at 50%” is the middle of any Reel, “at 100%, −3 s” the last three seconds.</p>
        </Card>
      </div>
      {/* the card as people see it */}
      <div className="hidden md:block"><div className="sticky top-0 flex flex-col gap-2"><span className="text-[12px] font-semibold text-muted">Preview</span><TemplateCard t={t} link={false} /></div></div>
    </div>
  );
}

/** a moment of the Reel: a share of its length, plus or minus seconds */
function EdgeIn({ label, e, on }: { label: string; e: TplEdge; on: (e: TplEdge) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={`${label} at % of the Reel`}><Input type="number" min={0} max={100} step={1} value={Math.round(e.p * 1000) / 10} onChange={(v) => on({ p: Math.min(1, Math.max(0, (num(v.target.value) ?? 0) / 100)), s: e.s })} /></Field>
      <Field label="± seconds"><Input type="number" min={-600} max={600} step={0.1} value={e.s} onChange={(v) => on({ p: e.p, s: num(v.target.value) ?? 0 })} /></Field>
    </div>
  );
}
