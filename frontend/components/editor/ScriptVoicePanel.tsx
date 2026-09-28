"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { op } from "@/lib/ops";
import { LANGUAGES, type EdlTimeline, type Language, type Script, type TimelineState } from "@/types/api";
import { btnDanger, btnPrimary, btnSecondary, ErrorBanner } from "../ui";

interface Props {
  projectId: string;
  timeline: EdlTimeline;
  busy: boolean;
  onEdit: (ops: object[], label?: string) => void;
  onState: (s: TimelineState) => void;
}

const FIELD = "rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50";

interface Line {
  text: string;
  pauseAfter: number | null;
}

/** Script, hooks and the voice-over. The server owns the script; local edits are saved explicitly. */
export function ScriptVoicePanel(props: Props) {
  const { projectId } = props;
  const script = useQuery({ queryKey: ["script", projectId], queryFn: () => api.script(projectId) });
  if (script.isLoading) return <section aria-label="Script and voice" className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">Loading script…</section>;
  if (script.error || !script.data) return <ErrorBanner message={errorMessage(script.error)} />;
  // keyed: when the saved script changes (generate / revise / save), the editor state resets to it
  return <Editor key={JSON.stringify([script.data.lines, script.data.language, script.data.hook, script.data.voiceProfileId])} saved={script.data} {...props} />;
}

function Editor({ saved, projectId, timeline, busy, onEdit, onState }: Props & { saved: Script }) {
  const qc = useQueryClient();
  const voices = useQuery({ queryKey: ["voices"], queryFn: api.voices });
  const systemVoices = useQuery({ queryKey: ["system-voices"], queryFn: api.systemVoices });
  const [lines, setLines] = useState<Line[]>(saved.lines.length ? saved.lines : []);
  const [language, setLanguage] = useState<Language>(saved.language);
  const [hook, setHook] = useState(saved.hook ?? "");
  const [cta, setCta] = useState(saved.cta ?? "");
  const [profileId, setProfileId] = useState(saved.voiceProfileId ?? "");
  const [hooks, setHooks] = useState<string[]>([]);

  const dirty = JSON.stringify({ l: lines, g: language, h: hook, c: cta, v: profileId }) !==
    JSON.stringify({ l: saved.lines, g: saved.language, h: saved.hook ?? "", c: saved.cta ?? "", v: saved.voiceProfileId ?? "" });
  const body = () => ({ language, lines: lines.filter((l) => l.text.trim()), hook: hook.trim() || null, cta: cta.trim() || null, tone: saved.tone, voiceProfileId: profileId || null });
  const refresh = () => qc.invalidateQueries({ queryKey: ["script", projectId] });

  const save = useMutation({ mutationFn: () => api.saveScript(projectId, body()), onSuccess: refresh });
  const makeHooks = useMutation({
    mutationFn: async () => {
      if (dirty) await api.saveScript(projectId, body()); // language may have changed
      return api.hooks(projectId, 3);
    },
    onSuccess: (r) => setHooks(r.hooks),
  });
  const generate = useMutation({
    mutationFn: async () => {
      await api.saveScript(projectId, body());
      return api.generateScript(projectId, { hook: hook.trim() || null, cta: cta.trim() || null });
    },
    onSuccess: refresh,
  });
  const revise = useMutation({
    mutationFn: async (i: "shorten" | "natural" | "energetic" | "regenerate") => {
      await api.saveScript(projectId, body());
      return api.reviseScript(projectId, i);
    },
    onSuccess: refresh,
  });
  const speak = useMutation({
    mutationFn: async () => {
      await api.saveScript(projectId, body());
      return api.generateVoice(projectId, profileId || undefined);
    },
    onSuccess: (r) => {
      onState(r.state);
      refresh();
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
  const remove = useMutation({ mutationFn: () => api.removeVoice(projectId), onSuccess: onState });

  const working = save.isPending || makeHooks.isPending || generate.isPending || revise.isPending || speak.isPending || remove.isPending;
  const disabled = busy || working;
  const error = save.error ?? makeHooks.error ?? generate.error ?? revise.error ?? speak.error ?? remove.error;
  const haveText = lines.some((l) => l.text.trim());
  const estimate = saved.estimatedSeconds;
  const voice = timeline.voice;
  const setLine = (i: number, patch: Partial<Line>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const coverage = systemVoices.data?.languages;
  const langMissing = coverage && !coverage[language];

  return (
    <section aria-label="Script and voice" className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Script &amp; voice-over</h3>
        <span className="text-xs text-muted">{haveText ? `Spoken length ≈ ${estimate.toFixed(1)}s` : "No script yet"} · Reel {timeline.duration.toFixed(1)}s</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Language</span>
          <select aria-label="Script language" className={`${FIELD} w-full`} value={language} disabled={disabled} onChange={(e) => setLanguage(e.target.value as Language)}>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Voice profile</span>
          <select aria-label="Voice profile" className={`${FIELD} w-full`} value={profileId} disabled={disabled} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Choose…</option>
            {voices.data?.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          {voices.data?.length === 0 && <span className="mt-1 block text-xs text-muted">Create a voice profile on the Voices page first.</span>}
        </label>
      </div>
      {langMissing && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          No offline voice for this language is installed on this computer, so the voice will be spoken with the closest available voice. Install a Windows voice pack for it to sound native.
        </p>
      )}

      {/* hook */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[12rem] flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Hook (the opening line)</span>
            <input aria-label="Hook" className={`${FIELD} w-full`} value={hook} maxLength={200} disabled={disabled} onChange={(e) => setHook(e.target.value)} />
          </label>
          <button type="button" className={btnSecondary} disabled={disabled} onClick={() => makeHooks.mutate()}>
            {makeHooks.isPending ? "Thinking…" : "✨ Generate 3 hooks"}
          </button>
        </div>
        {hooks.length > 0 && (
          <ul aria-label="Hook options" className="space-y-1">
            {hooks.map((h) => (
              <li key={h}>
                <button
                  type="button"
                  className={`w-full rounded-lg border px-3 py-1.5 text-left text-sm ${h === hook ? "border-accent bg-accent/10" : "border-border hover:border-accent/60"}`}
                  onClick={() => setHook(h)}
                >
                  {h}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">Call to action (the closing line)</span>
        <input aria-label="Call to action" className={`${FIELD} w-full`} value={cta} maxLength={200} disabled={disabled} onChange={(e) => setCta(e.target.value)} />
      </label>

      {/* lines */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} disabled={disabled} onClick={() => generate.mutate()}>
            {generate.isPending ? "Writing…" : haveText ? "Write a new script" : "✨ Write script with AI"}
          </button>
          {haveText && (
            <>
              <button type="button" className={btnSecondary} disabled={disabled} onClick={() => revise.mutate("shorten")}>Shorten</button>
              <button type="button" className={btnSecondary} disabled={disabled} onClick={() => revise.mutate("natural")}>Make natural</button>
              <button type="button" className={btnSecondary} disabled={disabled} onClick={() => revise.mutate("energetic")}>Make energetic</button>
              <button type="button" className={btnSecondary} disabled={disabled} onClick={() => revise.mutate("regenerate")}>Regenerate</button>
            </>
          )}
        </div>
        <ol aria-label="Script lines" className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-2 w-5 text-right text-xs text-muted">{i + 1}</span>
              <textarea
                aria-label={`Line ${i + 1}`}
                rows={2}
                maxLength={220}
                className={`${FIELD} min-w-0 flex-1 resize-y`}
                value={l.text}
                disabled={disabled}
                onChange={(e) => setLine(i, { text: e.target.value })}
              />
              <label className="text-xs text-muted">
                pause
                <input
                  type="number"
                  aria-label={`Pause after line ${i + 1}`}
                  min={0}
                  max={3}
                  step={0.1}
                  placeholder="auto"
                  className={`${FIELD} mt-1 block w-16`}
                  value={l.pauseAfter ?? ""}
                  disabled={disabled}
                  onChange={(e) => setLine(i, { pauseAfter: e.target.value === "" ? null : Number(e.target.value) })}
                />
              </label>
              <button type="button" aria-label={`Remove line ${i + 1}`} className="mt-1.5 px-1 text-muted hover:text-danger" disabled={disabled} onClick={() => setLines((c) => c.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} disabled={disabled || lines.length >= 20} onClick={() => setLines((c) => [...c, { text: "", pauseAfter: null }])}>
            ＋ Add line
          </button>
          <button type="button" className={btnSecondary} disabled={disabled || !dirty} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save script"}
          </button>
        </div>
      </div>

      {/* voice */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} disabled={disabled || !haveText || !profileId} onClick={() => speak.mutate()}>
            {speak.isPending ? "Speaking…" : voice ? "Regenerate voice-over" : "Generate voice-over"}
          </button>
          {voice && (
            <button type="button" className={btnDanger} disabled={disabled} onClick={() => remove.mutate()}>
              Remove voice-over
            </button>
          )}
        </div>
        {!profileId && haveText && <p className="text-xs text-muted">Choose a voice profile to generate the voice-over.</p>}
        <p className="text-xs text-muted">
          Generating the voice re-times the Reel to fit it: shots and captions follow the spoken lines. You can undo this from the toolbar.
        </p>
        {voice && <VoiceMix key={`${voice.volume}-${voice.duckMusic}-${voice.start}`} voice={voice} busy={busy || working} onEdit={onEdit} />}
      </div>

      {error && <ErrorBanner message={errorMessage(error)} />}
    </section>
  );
}

function VoiceMix({ voice, busy, onEdit }: { voice: NonNullable<EdlTimeline["voice"]>; busy: boolean; onEdit: Props["onEdit"] }) {
  const [volume, setVolume] = useState(voice.volume);
  const commit = () => volume !== voice.volume && onEdit([op.voiceMix({ volume })], "Voice volume");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">Voice volume · {Math.round(volume * 100)}%</span>
        <input
          type="range"
          aria-label="Voice volume"
          min={0}
          max={2}
          step={0.05}
          value={volume}
          disabled={busy}
          className="w-full accent-[var(--accent)]"
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={voice.duckMusic}
          disabled={busy}
          onChange={(e) => onEdit([op.voiceMix({ duckMusic: e.target.checked })], "Music ducking")}
          className="h-4 w-4 accent-[var(--accent)]"
        />
        Lower the music while the voice speaks
      </label>
    </div>
  );
}
