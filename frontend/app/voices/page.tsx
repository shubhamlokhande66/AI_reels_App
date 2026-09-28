"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { btnDanger, btnPrimary, btnSecondary, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { LANGUAGES, type Language, type VoiceProfile, type VoiceProfileInput } from "@/types/api";

const FIELD = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
const EMPTY: VoiceProfileInput = {
  name: "",
  voice: null,
  language: "en",
  speed: 1,
  pitch: 0,
  energy: "medium",
  emotion: "friendly",
  pauseStyle: "natural",
  pronunciations: {},
};

const toLines = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${k} = ${v}`).join("\n");
const fromLines = (t: string) =>
  Object.fromEntries(
    t
      .split("\n")
      .map((l) => l.split("="))
      .filter((p) => p.length >= 2 && p[0].trim() && p.slice(1).join("=").trim())
      .map((p) => [p[0].trim(), p.slice(1).join("=").trim()]),
  );

export default function VoicesPage() {
  const qc = useQueryClient();
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
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["voices"] });
    },
  });
  const del = useMutation({ mutationFn: api.deleteVoice, onSuccess: () => qc.invalidateQueries({ queryKey: ["voices"] }) });

  async function preview(p: VoiceProfile) {
    setPreviewError(null);
    setPreviewing(p.id);
    try {
      const blob = await api.previewVoice(p.id);
      const url = URL.createObjectURL(blob);
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

  return (
    <>
      <PageHeader
        title="Voice Profiles"
        subtitle="How your voice-overs sound. Runs offline on this computer."
        action={
          <button type="button" className={btnPrimary} onClick={() => setEditing({ id: null, data: EMPTY, pron: "" })}>
            ＋ New voice profile
          </button>
        }
      />

      {system.isLoading && <Spinner />}
      {system.data && (
        <Card className="mb-6">
          <h2 className="mb-2 font-medium">Installed voices</h2>
          {system.data.available ? (
            <ul className="mb-3 flex flex-wrap gap-2 text-sm">
              {system.data.voices.map((v) => (
                <li key={v.id} className="rounded-full bg-surface-2 px-3 py-1">
                  {v.name} <span className="text-muted">· {v.language}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-danger">No offline voice engine was found on this computer.</p>
          )}
          {coverage && (
            <div className="flex flex-wrap gap-2 text-xs" aria-label="Language coverage">
              {LANGUAGES.map((l) => (
                <span key={l.id} className={`rounded-full px-2.5 py-0.5 ${coverage[l.id] ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
                  {l.label}: {coverage[l.id] ? "voice available" : "no voice installed"}
                </span>
              ))}
            </div>
          )}
          {system.data.note && <p className="mt-3 text-xs text-muted">{system.data.note}</p>}
        </Card>
      )}

      {previewError && <div className="mb-4"><ErrorBanner message={previewError} /></div>}
      {profiles.isLoading && <Spinner />}
      {profiles.error && <ErrorBanner message={errorMessage(profiles.error)} />}
      {profiles.data && profiles.data.length === 0 && !editing && (
        <EmptyState title="No voice profiles yet" hint="Create one, then choose it in the editor to speak your script." />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {profiles.data?.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{p.name}</h3>
                <p className="text-xs text-muted">
                  {LANGUAGES.find((l) => l.id === p.language)?.label} · {p.emotion} · {p.energy} energy · {p.speed}x · {p.pauseStyle} pauses
                </p>
              </div>
              <button type="button" className={btnSecondary} disabled={previewing === p.id} onClick={() => preview(p)} aria-label={`Preview ${p.name}`}>
                {previewing === p.id ? "…" : "▶ Preview"}
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setEditing({ id: p.id, data: { ...p }, pron: toLines(p.pronunciations) })}>
                Edit
              </button>
              <button
                type="button"
                className={btnDanger}
                onClick={() => window.confirm(`Delete voice profile "${p.name}"?`) && del.mutate(p.id)}
              >
                Delete
              </button>
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <Card className="mt-6">
          <form
            aria-label="Voice profile"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing);
            }}
          >
            <h2 className="font-medium">{editing.id ? "Edit voice profile" : "New voice profile"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Name</span>
                <input required maxLength={60} className={FIELD} value={editing.data.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. My Marathi Voice" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Language</span>
                <select className={FIELD} value={editing.data.language} onChange={(e) => set("language", e.target.value as Language)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                      {coverage && !coverage[l.id] ? " (no voice installed)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Voice</span>
                <select className={FIELD} value={editing.data.voice ?? ""} onChange={(e) => set("voice", e.target.value || null)}>
                  <option value="">Automatic (by language)</option>
                  {system.data?.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.language})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Emotion</span>
                <select className={FIELD} value={editing.data.emotion} onChange={(e) => set("emotion", e.target.value as VoiceProfileInput["emotion"])}>
                  {["neutral", "friendly", "energetic", "calm", "serious"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Speaking speed · {editing.data.speed.toFixed(2)}x</span>
                <input type="range" aria-label="Speaking speed" min={0.5} max={2} step={0.01} value={editing.data.speed} onChange={(e) => set("speed", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Pitch · {editing.data.pitch > 0 ? "+" : ""}{editing.data.pitch}%</span>
                <input type="range" aria-label="Pitch" min={-30} max={30} step={1} value={editing.data.pitch} onChange={(e) => set("pitch", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Energy</span>
                <select className={FIELD} value={editing.data.energy} onChange={(e) => set("energy", e.target.value as VoiceProfileInput["energy"])}>
                  {["low", "medium", "high"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Pauses</span>
                <select className={FIELD} value={editing.data.pauseStyle} onChange={(e) => set("pauseStyle", e.target.value as VoiceProfileInput["pauseStyle"])}>
                  {["tight", "natural", "dramatic"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted">Pronunciation (one per line: written word = how to say it)</span>
              <textarea aria-label="Pronunciation" rows={3} className={FIELD} value={editing.pron} onChange={(e) => setEditing({ ...editing, pron: e.target.value })} placeholder="Namora = Nuh-more-uh" />
            </label>
            {save.error && <ErrorBanner message={errorMessage(save.error)} />}
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={save.isPending || !editing.data.name.trim()}>
                {save.isPending ? "Saving…" : "Save voice profile"}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
            <p className="text-xs text-muted">
              Pitch, energy and emotion are applied as speech prosody by the engine. Voice cloning is not available in this version.
            </p>
          </form>
        </Card>
      )}
    </>
  );
}
