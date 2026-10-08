"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { btnDanger, btnPrimary, btnSecondary, Card, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { useStyles, useTrends } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { STYLE_LABELS } from "@/lib/format";
import { takeTemplateDraft } from "@/lib/templateDraftHandoff";
import { LANGUAGES, type Language, type Template, type TemplateInput } from "@/types/api";

const FIELD = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
const AUDIO_MODES = [
  ["music", "Music only"],
  ["voice_music", "Voice-over + music"],
  ["voice", "Voice-over only"],
  ["original", "Original clip audio"],
  ["none", "No audio"],
] as const;
const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];

const BLANK: TemplateInput = {
  name: "",
  description: "",
  duration: 15,
  style: "fast_trending",
  pace: "balanced",
  hook: true,
  captions: false,
  captionStyle: "minimal",
  audioMode: "music",
  musicSync: true,
  ai: false,
  language: "en",
  exportPreset: "instagram_reel",
};

const toInput = (t: Template | TemplateInput): TemplateInput => ({
  name: t.name,
  description: t.description,
  duration: t.duration,
  style: t.style,
  pace: t.pace,
  hook: t.hook,
  captions: t.captions,
  captionStyle: t.captionStyle,
  audioMode: t.audioMode,
  musicSync: t.musicSync,
  ai: t.ai,
  language: t.language,
  exportPreset: t.exportPreset,
});

interface Editing {
  id: string | null;
  data: TemplateInput;
  isDraft: boolean;
}

export default function TemplatesPage() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates });
  const styles = useStyles();
  const trends = useTrends();
  // Arriving from Chat's "Save as Reel template": pick up the AI draft it left (read once — it clears itself),
  // same review-before-save flow as generating one right here.
  const [pendingChatDraft] = useState(() => takeTemplateDraft());
  const [editing, setEditing] = useState<Editing | null>(() => (pendingChatDraft ? { id: null, data: pendingChatDraft, isDraft: true } : null));
  const [prompt, setPrompt] = useState("");
  const [draftNote, setDraftNote] = useState<string | null>(() =>
    pendingChatDraft ? "This is an AI draft from your Chat conversation. Review it, change anything you like, then save." : null,
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["templates"] });
  const save = useMutation({
    mutationFn: (e: Editing) => (e.id ? api.updateTemplate(e.id, e.data) : api.createTemplate(e.data)),
    onSuccess: () => {
      setEditing(null);
      setDraftNote(null);
      refresh();
    },
  });
  const del = useMutation({ mutationFn: api.deleteTemplate, onSuccess: refresh });
  const fav = useMutation({ mutationFn: (v: { id: string; favorite: boolean }) => api.favoriteTemplate(v.id, v.favorite), onSuccess: refresh });
  const generate = useMutation({
    mutationFn: () => api.generateTemplate(prompt.trim()),
    onSuccess: (r) => {
      setEditing({ id: null, data: toInput(r.template), isDraft: true });
      setDraftNote("This is an AI draft. Review it, change anything you like, then save.");
    },
  });

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setEditing((e) => e && { ...e, data: { ...e.data, [k]: v } });
  const list = templates.data ?? [];
  const favorites = list.filter((t) => t.favorite);
  const rest = list.filter((t) => !t.favorite);

  const card = (t: Template) => (
    <Card key={t.id} className="relative transition-colors hover:border-accent/50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">
            {/* the whole card opens Create with this template (the buttons below stay separate) */}
            <Link href={`/projects/new?template=${t.id}`} className="after:absolute after:inset-0 after:rounded-[inherit] hover:text-accent">
              {t.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {t.builtin ? "Built-in" : "Yours"} · {t.duration}s · {STYLE_LABELS[t.style] ?? t.style} · {t.pace}
            {t.uses > 0 ? ` · used ${t.uses}×` : ""}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={t.favorite}
          aria-label={t.favorite ? `Remove ${t.name} from favorites` : `Add ${t.name} to favorites`}
          onClick={() => fav.mutate({ id: t.id, favorite: !t.favorite })}
          className="relative z-10 text-lg leading-none hover:text-accent"
        >
          {t.favorite ? "★" : "☆"}
        </button>
      </div>
      {t.description && <p className="mt-2 text-sm text-muted">{t.description}</p>}
      <p className="mt-2 text-xs text-muted">
        {AUDIO_MODES.find((m) => m[0] === t.audioMode)?.[1]}
        {t.captions ? ` · ${t.captionStyle} captions` : " · no captions"}
        {t.ai ? " · AI assisted" : ""}
      </p>
      <div className="relative z-10 mt-3 flex flex-wrap gap-2">
        <Link href={`/projects/new?template=${t.id}`} className={btnPrimary}>
          Use template
        </Link>
        <button
          type="button"
          className={btnSecondary}
          onClick={() => {
            setDraftNote(null);
            setEditing({ id: t.builtin ? null : t.id, data: t.builtin ? { ...toInput(t), name: `${t.name} (copy)` } : toInput(t), isDraft: false });
          }}
        >
          {t.builtin ? "Duplicate" : "Edit"}
        </button>
        {!t.builtin && (
          <button type="button" className={btnDanger} onClick={() => window.confirm(`Delete template "${t.name}"?`) && del.mutate(t.id)}>
            Delete
          </button>
        )}
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Save a way of working once, start every new Reel from it."
        action={
          <button type="button" className={btnPrimary} onClick={() => { setDraftNote(null); setEditing({ id: null, data: BLANK, isDraft: false }); }}>
            ＋ New template
          </button>
        }
      />

      <Card className="mb-6">
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label="Generate template"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim()) generate.mutate();
          }}
        >
          <label className="min-w-[16rem] flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Describe the template you want (AI drafts it, you review before saving)</span>
            <input
              aria-label="Template idea"
              value={prompt}
              maxLength={300}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Create a template for luxury jewellery product reels"
              className={FIELD}
            />
          </label>
          <button type="submit" className={btnSecondary} disabled={generate.isPending || !prompt.trim()}>
            {generate.isPending ? "Drafting…" : "✨ Draft with AI"}
          </button>
        </form>
        {generate.error && <div className="mt-3"><ErrorBanner message={errorMessage(generate.error)} /></div>}
      </Card>

      {editing && (
        <Card className="mb-6">
          <form
            aria-label="Template"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing);
            }}
          >
            <h2 className="font-medium">{editing.id ? "Edit template" : editing.isDraft ? "Review AI draft" : "New template"}</h2>
            {draftNote && <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{draftNote}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Name</span>
                <input required maxLength={80} className={FIELD} value={editing.data.name} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Description</span>
                <input maxLength={300} className={FIELD} value={editing.data.description} onChange={(e) => set("description", e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Duration in seconds (5 to 600)</span>
                <input type="number" aria-label="Duration" min={5} max={600} step={1} value={editing.data.duration} onChange={(e) => set("duration", Math.min(Math.max(Number(e.target.value) || 5, 5), 600))} className={FIELD} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Style</span>
                <select className={FIELD} value={editing.data.style} onChange={(e) => set("style", e.target.value)}>
                  {(styles.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  {!styles.data && <option value={editing.data.style}>{STYLE_LABELS[editing.data.style] ?? editing.data.style}</option>}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Pace</span>
                <select className={FIELD} value={editing.data.pace} onChange={(e) => set("pace", e.target.value as TemplateInput["pace"])}>
                  {["calm", "balanced", "fast"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Audio</span>
                <select className={FIELD} value={editing.data.audioMode} onChange={(e) => set("audioMode", e.target.value)}>
                  {AUDIO_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Caption style</span>
                <select className={FIELD} value={editing.data.captionStyle} onChange={(e) => set("captionStyle", e.target.value)}>
                  {CAPTION_STYLES.map((v) => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Language</span>
                <select className={FIELD} value={editing.data.language} onChange={(e) => set("language", e.target.value as Language)}>
                  {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-5 text-sm">
              {([
                ["captions", "Captions"],
                ["hook", "Suggest a hook"],
                ["musicSync", "Cut on the beat"],
                ["ai", "AI assisted"],
              ] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={editing.data[k]} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                  {l}
                </label>
              ))}
            </div>
            {save.error && <ErrorBanner message={errorMessage(save.error)} />}
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={save.isPending || !editing.data.name.trim()}>
                {save.isPending ? "Saving…" : "Save template"}
              </button>
              <button type="button" className={btnSecondary} onClick={() => { setEditing(null); setDraftNote(null); }}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      {templates.isLoading && <Spinner />}
      {templates.error && <ErrorBanner message={errorMessage(templates.error)} onRetry={() => templates.refetch()} />}

      {favorites.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 font-semibold">Favorites</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{favorites.map(card)}</div>
        </section>
      )}
      <section>
        <h2 className="mb-3 font-semibold">{favorites.length ? "All templates" : "Templates"}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{rest.map(card)}</div>
      </section>

      <section className="mt-10">
        <h2 className="mb-2 font-semibold">Editing styles</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {styles.data?.map((s) => (
            <Link key={s.id} href={`/projects/new?style=${s.id}`} className="group block">
              <Card className="h-full transition-colors group-hover:border-accent/50">
                <h3 className="font-medium group-hover:text-accent">{s.name}</h3>
                <p className="mt-1 text-sm text-muted">{s.description}</p>
                <p className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>Default captions: {s.captionStyle}</span>
                  <span className="text-accent">Use this style →</span>
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-semibold">Trend presets</h2>
        <p className="mb-3 text-sm text-muted">
          Proven pacing for popular Reel formats. Tap one to start a Reel with it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trends.data?.map((t) => (
            <Link key={t.id} href={`/projects/new?trend=${t.id}`} className="group block">
              <Card className="h-full transition-colors group-hover:border-accent/50">
                <h3 className="font-medium group-hover:text-accent">{t.trendName}</h3>
                <p className="mt-1 text-sm text-muted">{t.description}</p>
                <p className="mt-3 text-xs text-muted">
                  {t.recommendedDuration}s · {t.cutFrequency} cuts · {t.transitionStyle} transitions · {t.captionStyle} captions
                </p>
                <p className="mt-2 text-xs text-accent">Use this trend →</p>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
