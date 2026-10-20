"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { Card } from "@/components/atoms";
import { ErrorBanner } from "@/components/molecules";
import { TemplateCard } from "@/components/molecules/TemplateCard";
import {
  edgeAt, groupsOf, isLive, todayIST, TPL_ANIMS, TPL_BGS, TPL_CAP_STYLES, TPL_LIMITS, TPL_LOOKS, TPL_MODES, TPL_MUSIC, TPL_PACES, TPL_TEXT_STYLES,
  type StudioTemplate, type TplEdge, type TplText,
} from "@/lib/studio-templates";

/** Admin → Templates: every template of Fast Studio, managed here. Add, change, hide, order; the song's length, the look,
 * the texts with the times they show on the Reel, and the days a template shows (a festival's week). Saved for everyone at
 * once; the app reads them from the server, no update needed. */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const blank = (n: number): StudioTemplate => ({ id: `new-${n}`, name: "New template", kind: "music", len: 15, text: "", group: "Everyday", on: false, edit: { look: "vivid", mode: "auto", style: "pop", texts: [] } });
const opts = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => <option key={k} value={k}>{v}</option>);
const status = (t: StudioTemplate, day: string) => (!t.on ? "Hidden" : isLive(t, day) ? "Live" : t.showFrom && day < t.showFrom ? `From ${t.showFrom}` : "Ended");

export function TemplatesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-templates"], queryFn: api.adminTemplates });
  // the changes not saved yet (null: none, the server's list is shown)
  const [draft, setDraft] = useState<StudioTemplate[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const list = draft ?? q.data?.templates ?? null, dirty = draft !== null;
  const save = useMutation({ mutationFn: api.setTemplates, onSuccess: (r) => { qc.setQueryData(["admin-templates"], r); setDraft(null); setMsg("Saved: people see the new templates now."); } });
  const reset = useMutation({ mutationFn: api.resetTemplates, onSuccess: (r) => { qc.setQueryData(["admin-templates"], r); setDraft(null); setOpen(null); setMsg("Back to the default templates."); } });
  if (q.error) return <ErrorBanner message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!list) return <Card><p className="m-0 text-sm">Loading…</p></Card>;
  const day = todayIST();
  const edit = (fn: (l: StudioTemplate[]) => void) => { const l = clone(list); fn(l); setDraft(l); setMsg(""); };
  const move = (i: number, d: number) => edit((l) => { const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; if (open === i) setOpen(j); });
  const live = list.filter((t) => isLive(t, day)).length;
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-sm">{list.length} template{list.length === 1 ? "" : "s"} · <b>{live} live today</b> ({day}){q.data?.saved ? "" : " · the defaults (nothing saved yet)"}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => edit((l) => { l.push(blank(l.length + 1)); setOpen(l.length - 1); })}>+ New template</button>
            <button type="button" className="btn" disabled={reset.isPending} onClick={() => { if (confirm("Throw away every change and go back to the default templates?")) reset.mutate(); }}>Defaults</button>
            <button type="button" className="btn primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(list)}>{save.isPending ? "Saving…" : "Save for everyone"}</button>
          </div>
        </div>
        {(save.error || msg) && <p className={`m-0 mt-2 text-sm ${save.error ? "text-danger" : "text-success"}`}>{save.error ? errorMessage(save.error) : msg}</p>}
        <p className="mu sm m-0 mt-1">The order here is the order people see (Home shows the first 6). Hidden ones are kept for later; dates show a template only on those days (India time).</p>
      </Card>
      {list.map((t, i) => (
        <Card key={i}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="min-w-0 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <b>{t.name}</b> <span className="text-xs text-muted">· {t.group} · {t.kind === "talk" ? "Talking" : `Music ${t.len ?? ""} s`} · {status(t, day)}{t.showFrom || t.showTo ? ` · ${t.showFrom || "…"} → ${t.showTo || "…"}` : ""}</span>
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={t.on} onChange={(e) => edit((l) => { l[i].on = e.target.checked; })} /> Show</label>
              <button type="button" className="btn mini" aria-label="Up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn mini" aria-label="Down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn mini" onClick={() => edit((l) => { const c = clone(l[i]); c.id = `${c.id}-copy`.slice(0, 40); c.name = `${c.name} copy`.slice(0, TPL_LIMITS.name); c.on = false; l.splice(i + 1, 0, c); setOpen(i + 1); })}>Copy</button>
              <button type="button" className="btn mini" onClick={() => setOpen(open === i ? null : i)}>{open === i ? "Close" : "Edit"}</button>
              <button type="button" className="btn mini" onClick={() => { if (confirm(`Delete "${t.name}"?`)) edit((l) => { l.splice(i, 1); setOpen(null); }); }}>Delete</button>
            </div>
          </div>
          {open === i && <Editor t={t} groups={groupsOf(list)} set={(fn) => edit((l) => fn(l[i]))} />}
        </Card>
      ))}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex flex-col gap-1 text-xs"><span className="text-muted">{label}</span>{children}</label>
);
const num = (v: string, d?: number) => (v.trim() === "" || !Number.isFinite(+v) ? d : +v);

function Editor({ t, groups, set }: { t: StudioTemplate; groups: string[]; set: (fn: (t: StudioTemplate) => void) => void }) {
  const e = t.edit, L = t.len ?? 30, texts = e.texts ?? [];
  const setText = (k: number, fn: (x: TplText) => void) => set((x) => { fn((x.edit.texts ??= [])[k]); });
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-[1fr_150px]">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Row label="Name"><input value={t.name} maxLength={TPL_LIMITS.name} onChange={(v) => set((x) => { x.name = v.target.value; })} /></Row>
          <Row label="Id (in the link, small letters)"><input value={t.id} maxLength={40} onChange={(v) => set((x) => { x.id = v.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"); })} /></Row>
          <Row label="Group">
            <input list="tpl-groups" value={t.group} maxLength={30} onChange={(v) => set((x) => { x.group = v.target.value; })} />
            <datalist id="tpl-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </Row>
          <Row label="Kind">
            <select value={t.kind} onChange={(v) => set((x) => { x.kind = v.target.value as "music" | "talk"; if (x.kind === "talk") { delete x.len; x.edit.pace ??= "natural"; x.edit.music ??= 0.05; x.edit.caps ??= true; } else x.len ??= 15; })}>
              <option value="music">Music (clips + a song)</option><option value="talk">Talking (clips of you speaking)</option>
            </select>
          </Row>
          {t.kind === "music" && <Row label="Length of the song (seconds)"><input type="number" min={5} max={180} value={t.len ?? ""} onChange={(v) => set((x) => { x.len = num(v.target.value) && Math.round(num(v.target.value)!); })} /></Row>}
          <Row label="Look"><select value={e.look} onChange={(v) => set((x) => { x.edit.look = v.target.value as never; })}>{opts(TPL_LOOKS)}</select></Row>
          {t.kind === "music" ? (
            <Row label="Cutting"><select value={e.mode ?? "auto"} onChange={(v) => set((x) => { x.edit.mode = v.target.value as never; })}>{opts(TPL_MODES)}</select></Row>
          ) : (
            <>
              <Row label="Pauses cut"><select value={e.pace ?? "natural"} onChange={(v) => set((x) => { x.edit.pace = v.target.value as never; })}>{opts(TPL_PACES)}</select></Row>
              <Row label="Music under the voice"><select value={String(e.music ?? 0.05)} onChange={(v) => set((x) => { x.edit.music = +v.target.value; })}>{TPL_MUSIC.map((m) => <option key={m} value={m}>{m === 0 ? "None" : `${Math.round(m * 100)}%`}</option>)}</select></Row>
            </>
          )}
          <Row label="Captions style"><select value={e.style ?? "pop"} onChange={(v) => set((x) => { x.edit.style = v.target.value as never; })}>{opts(TPL_CAP_STYLES)}</select></Row>
          <Row label="Background"><select value={e.bg ?? "none"} onChange={(v) => set((x) => { x.edit.bg = v.target.value as never; })}>{opts(TPL_BGS)}</select></Row>
          <label className="flex items-center gap-2 self-end text-xs"><input type="checkbox" checked={!!e.caps} onChange={(v) => set((x) => { x.edit.caps = v.target.checked; })} /> Captions on</label>
          <label className="flex items-center gap-2 self-end text-xs"><input type="checkbox" checked={!!t.isNew} onChange={(v) => set((x) => { x.isNew = v.target.checked; })} /> “New” badge</label>
        </div>
        <Row label="What it does (one line, on the card)"><input value={t.text} maxLength={TPL_LIMITS.text} onChange={(v) => set((x) => { x.text = v.target.value; })} /></Row>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Row label="Hook text of the opener (optional)"><input value={e.hook ?? ""} maxLength={TPL_LIMITS.line} onChange={(v) => set((x) => { x.edit.hook = v.target.value || undefined; })} /></Row>
          <Row label="Show from (empty = always)"><input type="date" value={t.showFrom ?? ""} onChange={(v) => set((x) => { x.showFrom = v.target.value || undefined; })} /></Row>
          <Row label="Show until"><input type="date" value={t.showTo ?? ""} onChange={(v) => set((x) => { x.showTo = v.target.value || undefined; })} /></Row>
        </div>
        <Row label="Cover picture address (optional: /templates/name.webp or https://…)"><input value={t.cover ?? ""} onChange={(v) => set((x) => { x.cover = v.target.value || undefined; })} /></Row>

        <div className="flex items-center justify-between">
          <b className="text-sm">Texts on the Reel ({texts.length}/{TPL_LIMITS.texts})</b>
          <button type="button" className="btn mini" disabled={texts.length >= TPL_LIMITS.texts} onClick={() => set((x) => { (x.edit.texts ??= []).push({ text: "Your text", style: "box", color: "#FFD54A", y: 0.25, from: { p: 0, s: 0 }, to: { p: 0, s: 3 } }); })}>+ Text</button>
        </div>
        {texts.map((x, k) => (
          <div key={k} className="flex flex-col gap-2 rounded-xl border border-white/10 p-2.5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Row label="Text"><input value={x.text} maxLength={TPL_LIMITS.line} onChange={(v) => setText(k, (y) => { y.text = v.target.value; })} /></Row>
              <Row label="Style"><select value={x.style} onChange={(v) => setText(k, (y) => { y.style = v.target.value as never; })}>{opts(TPL_TEXT_STYLES)}</select></Row>
              <Row label="Animation"><select value={x.anim ?? "pop"} onChange={(v) => setText(k, (y) => { y.anim = v.target.value as never; })}>{opts(TPL_ANIMS)}</select></Row>
              <Row label="Colour"><input type="color" value={x.color} onChange={(v) => setText(k, (y) => { y.color = v.target.value.toUpperCase(); })} /></Row>
              <Row label={`Height on screen: ${Math.round(x.y * 100)}% from the top`}><input type="range" min={3} max={97} value={Math.round(x.y * 100)} onChange={(v) => setText(k, (y) => { y.y = +v.target.value / 100; })} /></Row>
              <Row label={`Size: ${(x.size ?? 1).toFixed(2)}×`}><input type="range" min={30} max={300} step={5} value={Math.round((x.size ?? 1) * 100)} onChange={(v) => setText(k, (y) => { y.size = +v.target.value / 100; })} /></Row>
              <Row label="When it shows">
                <select value={x.all ? "all" : "span"} onChange={(v) => setText(k, (y) => { y.all = v.target.value === "all"; if (!y.all) { y.from ??= { p: 0, s: 0 }; y.to ??= { p: 1, s: 0 }; } })}>
                  <option value="all">The whole Reel</option><option value="span">From … to …</option>
                </select>
              </Row>
              <div className="flex items-end gap-1">
                <button type="button" className="btn mini" disabled={k === 0} onClick={() => set((y) => { const a = y.edit.texts!; [a[k - 1], a[k]] = [a[k], a[k - 1]]; })}>↑</button>
                <button type="button" className="btn mini" onClick={() => set((y) => { y.edit.texts!.splice(k, 1); })}>Delete</button>
              </div>
            </div>
            {!x.all && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <EdgeIn label="Starts" e={x.from ?? { p: 0, s: 0 }} on={(v) => setText(k, (y) => { y.from = v; })} />
                <EdgeIn label="Ends" e={x.to ?? { p: 1, s: 0 }} on={(v) => setText(k, (y) => { y.to = v; })} />
                <span className="self-end text-xs text-muted">
                  {t.kind === "talk" ? "On a 30 s Reel" : `On this ${L} s Reel`}: {edgeAt(x.from, L, 0).toFixed(1)}–{edgeAt(x.to, L, L).toFixed(1)} s
                  {edgeAt(x.from, L, 0) >= edgeAt(x.to, L, L) && <b className="text-danger"> · ends before it starts</b>}
                </span>
              </div>
            )}
          </div>
        ))}
        <p className="mu sm m-0">Times follow the Reel’s length: “at 50%” is the middle of any Reel, “at 100%, −3 s” the last three seconds. The person can change everything after.</p>
      </div>
      <div className="hidden md:block"><TemplateCard t={t} /></div>
    </div>
  );
}

/** a moment of the Reel: a share of its length, plus or minus seconds */
function EdgeIn({ label, e, on }: { label: string; e: TplEdge; on: (e: TplEdge) => void }) {
  return (
    <div className="flex items-end gap-1.5 text-xs">
      <Row label={`${label} at % of the Reel`}><input type="number" min={0} max={100} step={1} value={Math.round(e.p * 1000) / 10} onChange={(v) => on({ p: Math.min(1, Math.max(0, (num(v.target.value) ?? 0) / 100)), s: e.s })} /></Row>
      <Row label="± seconds"><input type="number" min={-600} max={600} step={0.1} value={e.s} onChange={(v) => on({ p: e.p, s: num(v.target.value) ?? 0 })} /></Row>
    </div>
  );
}
