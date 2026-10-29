"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Icon, IconButton, Input, Select, Spinner, TextArea } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field, PageHeader, SidePanel } from "@/components/molecules";
import { confirmAction } from "@/components/molecules/ConfirmDialog";
import { useText } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TONE_BG } from "@/lib/ui";
import { LANGUAGES, type Language, type VoiceProfile, type VoiceProfileInput } from "@/types/api";

const EMPTY: VoiceProfileInput = { name: "", voice: null, language: "en", speed: 1, pitch: 0, energy: "medium", emotion: "friendly", pauseStyle: "natural", pronunciations: {} };
const EMOTIONS = ["neutral", "friendly", "energetic", "calm", "serious"] as const;
const ENERGIES = ["low", "medium", "high"] as const;
const PAUSES = ["tight", "natural", "dramatic"] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** a voice's name as people read it: no engine or vendor ("Kore · firm (AI, any language)" → "Kore · firm",
 * "Microsoft David Desktop" → "David") */
const voiceName = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, "").replace(/^Microsoft\s+/, "").replace(/\s+Desktop$/, "");

const toLines = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k} = ${v}`).join("\n");
const fromLines = (t: string) =>
  Object.fromEntries(t.split("\n").map((l) => l.split("=")).filter((p) => p.length >= 2 && p[0].trim() && p.slice(1).join("=").trim()).map((p) => [p[0].trim(), p.slice(1).join("=").trim()]));

/** Voice profiles (/voices, a Pro page: lib/plan-locks.ts page:voices): each person's own voices for voice-overs. One
 * loader while it loads; the profiles as cards (play a sample, edit, delete); the form on the right (the voices by
 * name only: no engine or vendor). */
export function VoiceProfiles() {
  const qc = useQueryClient();
  const text = useText();
  const system = useQuery({ queryKey: ["system-voices"], queryFn: api.systemVoices });
  const profiles = useQuery({ queryKey: ["voices"], queryFn: api.voices });
  const [editing, setEditing] = useState<{ id: string | null; data: VoiceProfileInput; pron: string } | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (e: NonNullable<typeof editing>) => {
      const data = { ...e.data, pronunciations: fromLines(e.pron) };
      return e.id ? api.updateVoice(e.id, data) : api.createVoice(data);
    },
    onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ["voices"] }); },
  });
  const del = useMutation({ mutationFn: api.deleteVoice, onSuccess: () => qc.invalidateQueries({ queryKey: ["voices"] }) });

  async function preview(p: VoiceProfile) {
    setPreviewError(null);
    setPreviewing(p.id);
    try {
      const url = URL.createObjectURL(await api.previewVoice(p.id));
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setPreviewError(errorMessage(e));
    } finally {
      setPreviewing(null);
    }
  }

  const coverage = system.data?.languages;
  const set = <K extends keyof VoiceProfileInput>(k: K, v: VoiceProfileInput[K]) => setEditing((e) => e && { ...e, data: { ...e.data, [k]: v } });
  const startNew = () => setEditing({ id: null, data: EMPTY, pron: "" });
  const list = profiles.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <PageHeader title={text("nav.voices")} subtitle={text("voices.sub")} action={list.length > 0 ? <Button size="sm" icon="plus" onClick={startNew}>{text("voices.new")}</Button> : undefined} />

      {/* one loader while either list loads */}
      {(profiles.isLoading || system.isLoading) ? <Spinner label={text("voices.loading")} /> : (
        <>
          {profiles.error && <ErrorBanner message={errorMessage(profiles.error)} onRetry={() => profiles.refetch()} />}
          {previewError && <ErrorBanner message={previewError} />}

          {profiles.data && !list.length && <EmptyState icon="mic" title={text("voices.none")} hint={text("voices.noneText")} action={<Button icon="plus" onClick={startNew}>{text("voices.new")}</Button>} />}

          {list.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((p) => (
                <Card key={p.id} as="article" className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white", TONE_BG.story)}><Icon name="mic" size={20} /></span>
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-[14.5px]">{p.name}</b>
                      <span className="text-[12px] text-muted">{LANGUAGES.find((l) => l.id === p.language)?.label}</span>
                    </div>
                    <Button size="sm" variant="secondary" icon={previewing === p.id ? undefined : "play"} loading={previewing === p.id} aria-label={text("voices.play", { name: p.name })} onClick={() => void preview(p)}>Play</Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone="brand">{cap(p.emotion)}</Badge>
                    <Badge>{text("voices.speed", { n: p.speed.toFixed(2) })}</Badge>
                    <Badge>{cap(p.energy)} energy</Badge>
                    <Badge>{cap(p.pauseStyle)} pauses</Badge>
                    {Object.keys(p.pronunciations ?? {}).length > 0 && <Badge>{Object.keys(p.pronunciations).length} words</Badge>}
                  </div>
                  <div className="flex items-center gap-1 border-t border-border pt-2">
                    <Button size="sm" variant="ghost" icon="pen" onClick={() => setEditing({ id: p.id, data: { ...p }, pron: toLines(p.pronunciations) })}>{text("voices.edit")}</Button>
                    <IconButton icon="trash" size={34} iconSize={16} plain label={`${text("voices.delete")} ${p.name}`} className="ml-auto text-danger"
                      onClick={() => void confirmAction({ title: text("voices.deleteTitle", { name: p.name }), danger: true, ok: text("voices.delete") }).then((ok) => ok && del.mutate(p.id))} />
                  </div>
                </Card>
              ))}
            </div>
          )}

        </>
      )}

      {/* the profile's form, on the right */}
      <SidePanel open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? text("voices.formEdit") : text("voices.formNew")} where={text("nav.voices")}
        footer={editing && <>
          {save.error ? <span className="mr-auto text-[12.5px] text-danger">{errorMessage(save.error)}</span> : <span className="mr-auto" />}
          <Button variant="secondary" onClick={() => setEditing(null)}>{text("common.cancel")}</Button>
          <Button icon="check" loading={save.isPending} disabled={!editing.data.name.trim()} onClick={() => save.mutate(editing)}>{save.isPending ? text("voices.saving") : text("voices.save")}</Button>
        </>}>
        {editing && (
          <form aria-label="Voice profile" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(editing); }}>
            <Card className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={text("voices.name")} className="sm:col-span-2"><Input required maxLength={60} value={editing.data.name} onChange={(e) => set("name", e.target.value)} placeholder={text("voices.namePlaceholder")} /></Field>
                <Field label={text("voices.language")}>
                  <Select value={editing.data.language} onChange={(e) => set("language", e.target.value as Language)}>
                    {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </Select>
                </Field>
                <Field label={text("voices.voice")}>
                  <Select value={editing.data.voice ?? ""} onChange={(e) => set("voice", e.target.value || null)}>
                    <option value="">{text("voices.auto")}</option>
                    {system.data?.voices.map((v) => <option key={v.id} value={v.id}>{voiceName(v.name)}</option>)}
                  </Select>
                </Field>
              </div>
              {coverage && !coverage[editing.data.language] && <p className="m-0 text-[12.5px] text-warning">{text("voices.noLanguage")}</p>}
            </Card>
            <Card className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={text("voices.emotion")}><Select value={editing.data.emotion} onChange={(e) => set("emotion", e.target.value as VoiceProfileInput["emotion"])}>{EMOTIONS.map((v) => <option key={v} value={v}>{cap(v)}</option>)}</Select></Field>
                <Field label={text("voices.energy")}><Select value={editing.data.energy} onChange={(e) => set("energy", e.target.value as VoiceProfileInput["energy"])}>{ENERGIES.map((v) => <option key={v} value={v}>{cap(v)}</option>)}</Select></Field>
                <Field label={text("voices.pauses")}><Select value={editing.data.pauseStyle} onChange={(e) => set("pauseStyle", e.target.value as VoiceProfileInput["pauseStyle"])}>{PAUSES.map((v) => <option key={v} value={v}>{cap(v)}</option>)}</Select></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={`${text("voices.speedLabel")} · ${editing.data.speed.toFixed(2)}×`}><input type="range" aria-label="Speaking speed" min={0.5} max={2} step={0.01} value={editing.data.speed} onChange={(e) => set("speed", Number(e.target.value))} className="h-11 accent-[var(--accent)]" /></Field>
                <Field label={`${text("voices.pitch")} · ${editing.data.pitch > 0 ? "+" : ""}${editing.data.pitch}%`}><input type="range" aria-label="Pitch" min={-30} max={30} step={1} value={editing.data.pitch} onChange={(e) => set("pitch", Number(e.target.value))} className="h-11 accent-[var(--accent)]" /></Field>
              </div>
            </Card>
            <Card className="flex flex-col gap-2">
              <Field label={text("voices.pron")}><TextArea aria-label="Pronunciation" rows={4} value={editing.pron} onChange={(e) => setEditing({ ...editing, pron: e.target.value })} placeholder="Namora = Nuh-more-uh" /></Field>
              <p className="m-0 text-[12px] text-muted">{text("voices.note")}</p>
            </Card>
          </form>
        )}
      </SidePanel>
    </div>
  );
}
