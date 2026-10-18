"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { btnPrimary, btnSecondary, Card, photoClass, Spinner } from "@/components/atoms";
import { ErrorBanner, PageHeader } from "@/components/molecules";
import { MoreMenu } from "@/components/molecules/MoreMenu";
import { useFeatures, useStyles, useTrends } from "@/hooks/useApi";
import { TemplateCard } from "@/components/molecules/TemplateCard";
import { STUDIO_TEMPLATES } from "@/lib/studio-templates";
import { api, errorMessage } from "@/lib/api";
import { STYLE_LABELS } from "@/lib/format";
import { takeTemplateDraft } from "@/lib/templateDraftHandoff";
import { LANGUAGES, type Language, type Template, type TemplateInput } from "@/types/api";
import { confirmAction } from "@/components/molecules/ConfirmDialog";

const FIELD = "inp";
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

/** The templates saved on the server (Administration -> Features -> Saved templates). */
function ServerTemplates() {
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
  const [gen, setGen] = useState<{ duration: number; language: Language; captionStyle: string }>({ duration: 30, language: "en", captionStyle: "minimal" });
  const [tab, setTab] = useState<"styles" | "trends">("styles");
  const generate = useMutation({
    mutationFn: () => api.generateTemplate(prompt.trim()),
    onSuccess: (r) => {
      // the choices made in the form win over the AI's guesses
      setEditing({ id: null, data: { ...toInput(r.template), duration: gen.duration, language: gen.language, captionStyle: gen.captionStyle, captions: true }, isDraft: true });
      setDraftNote("This is an AI draft. Review it, change anything you like, then save.");
    },
  });

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => setEditing((e) => e && { ...e, data: { ...e.data, [k]: v } });
  const list = templates.data ?? [];
  const favorites = list.filter((t) => t.favorite);
  const rest = list.filter((t) => !t.favorite);

  const tile = (t: Template) => (
    <Link key={t.id} href={`/projects/new?template=${t.id}`} className="group flex flex-col gap-1">
      <div className={`photo ${photoClass(t.id)} aspect-[3/4]`} />
      <b className="xs truncate group-hover:text-accent">{t.name}</b>
    </Link>
  );
  const row = (t: Template) => (
    <div key={t.id} className="lr">
      <div className={`photo ${photoClass(t.id)} h-14 w-11 shrink-0`} />
      <span className="meta">
        <b>{t.name}</b>
        <span className="mu sm truncate">
          {t.duration} s · {STYLE_LABELS[t.style] ?? t.style} · {t.captions ? `${t.captionStyle} captions` : "no captions"}
          {t.uses > 0 ? ` · used ${t.uses}×` : ""}
        </span>
      </span>
      <Link href={`/projects/new?template=${t.id}`} className="btn sm">
        Use →
      </Link>
      <MoreMenu
        label={`More for ${t.name}`}
        items={[
          { label: t.favorite ? "Remove from favorites" : "Add to favorites", icon: "star", onClick: () => fav.mutate({ id: t.id, favorite: !t.favorite }) },
          {
            label: t.builtin ? "Duplicate and change" : "Edit",
            icon: "copy",
            onClick: () => {
              setDraftNote(null);
              setEditing({ id: t.builtin ? null : t.id, data: t.builtin ? { ...toInput(t), name: `${t.name} (copy)` } : toInput(t), isDraft: false });
              window.scrollTo({ top: 0, behavior: "smooth" });
            },
          },
          ...(!t.builtin ? [{ label: "Delete", icon: "trash", danger: true, onClick: () => void confirmAction({ title: `Delete the template "${t.name}"?`, danger: true, ok: "Delete" }).then((ok) => ok && del.mutate(t.id)) }] : []),
        ]}
      />
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="between mt-4">
        <div>
          <h2 className="ht">Your saved templates</h2>
          <p className="sub">Save a way of working once, start every new Reel from it.</p>
        </div>
        <button type="button" className="btn sm hidden md:inline-flex" onClick={() => { setDraftNote(null); setEditing({ id: null, data: BLANK, isDraft: false }); }}>
          + Make one by hand
        </button>
      </div>

      <form
        className="card"
        aria-label="Generate template"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) generate.mutate();
        }}
      >
        <span className="h2">Generate a template from an idea</span>
        <div className="g2">
          <label className="f">
            Duration
            <select className="inp" value={gen.duration} onChange={(e) => setGen({ ...gen, duration: Number(e.target.value) })}>
              {[15, 30, 60].map((d) => (
                <option key={d} value={d}>
                  {d} seconds
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            Language
            <select className="inp" value={gen.language} onChange={(e) => setGen({ ...gen, language: e.target.value as Language })}>
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="f">
          Caption style
          <select className="inp capitalize" value={gen.captionStyle} onChange={(e) => setGen({ ...gen, captionStyle: e.target.value })}>
            {CAPTION_STYLES.map((v) => (
              <option key={v} value={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Description
          <input aria-label="Template idea" className="inp" value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A calm morning routine, soft cuts" />
        </label>
        <button type="submit" className="btn g" disabled={generate.isPending || !prompt.trim()}>
          {generate.isPending ? "Writing your template…" : "Create template"}
        </button>
        <span className="mu xs">The AI writes a draft; you check it before it is saved.</span>
        {generate.error && <ErrorBanner message={errorMessage(generate.error)} />}
      </form>

      {editing && (
        <Card>
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
                <span className="mb-1 block text-xs font-bold text-muted">Name</span>
                <input required maxLength={80} className={FIELD} value={editing.data.name} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-bold text-muted">Description</span>
                <input maxLength={300} className={FIELD} value={editing.data.description} onChange={(e) => set("description", e.target.value)} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-bold text-muted">Duration in seconds (5 to 600)</span>
                <input type="number" aria-label="Duration" min={5} max={600} step={1} value={editing.data.duration} onChange={(e) => set("duration", Math.min(Math.max(Number(e.target.value) || 5, 5), 600))} className={FIELD} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-bold text-muted">Style</span>
                <select className={FIELD} value={editing.data.style} onChange={(e) => set("style", e.target.value)}>
                  {(styles.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  {!styles.data && <option value={editing.data.style}>{STYLE_LABELS[editing.data.style] ?? editing.data.style}</option>}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-bold text-muted">Pace</span>
                <select className={FIELD} value={editing.data.pace} onChange={(e) => set("pace", e.target.value as TemplateInput["pace"])}>
                  {["calm", "balanced", "fast"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-bold text-muted">Audio</span>
                <select className={FIELD} value={editing.data.audioMode} onChange={(e) => set("audioMode", e.target.value)}>
                  {AUDIO_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-bold text-muted">Caption style</span>
                <select className={FIELD} value={editing.data.captionStyle} onChange={(e) => set("captionStyle", e.target.value)}>
                  {CAPTION_STYLES.map((v) => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-bold text-muted">Language</span>
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
        <>
          <div className="between">
            <h2 className="ht">Favorites</h2>
            <span className="mu sm">{favorites.length}</span>
          </div>
          <div className="g4 sm:!grid-cols-6">{favorites.map(tile)}</div>
        </>
      )}
      {list.length > 0 && (
        <>
          <h2 className="ht">{favorites.length ? "All templates" : "Your templates"}</h2>
          <div className="flex flex-col gap-2">{[...favorites, ...rest].map(row)}</div>
        </>
      )}

      <div className="between flex-wrap">
        <h2 className="ht">Editing styles</h2>
        <span className="chips" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={tab === "styles"} className={`chip ${tab === "styles" ? "on" : ""}`} onClick={() => setTab("styles")}>
            Styles
          </button>
          <button type="button" role="tab" aria-selected={tab === "trends"} className={`chip ${tab === "trends" ? "on" : ""}`} onClick={() => setTab("trends")}>
            Trend presets
          </button>
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {tab === "styles"
          ? styles.data?.map((x) => (
              <div key={x.id} className="lr">
                <div className={`photo ${photoClass(x.id)} h-14 w-11 shrink-0`} />
                <span className="meta">
                  <b>{x.name}</b>
                  <span className="mu sm line-clamp-2">{x.description}</span>
                </span>
                <Link href={`/projects/new?style=${x.id}`} className="btn sm">
                  Use →
                </Link>
              </div>
            ))
          : trends.data?.map((t) => (
              <div key={t.id} className="lr">
                <div className={`photo ${photoClass(t.id)} h-14 w-11 shrink-0`} />
                <span className="meta">
                  <b>{t.trendName}</b>
                  <span className="mu sm truncate">
                    {t.recommendedDuration} s · {t.cutFrequency} cuts · {t.transitionStyle} transitions
                  </span>
                </span>
                <Link href={`/projects/new?trend=${t.id}`} className="btn sm">
                  Use →
                </Link>
              </div>
            ))}
      </div>
    </div>
  );
}

const GROUPS = ["Everyday", "Business", "Travel & food", "Festivals"] as const;

/** Templates: Fast Studio's ready-made Reels (always), then the templates saved on the server when that part is on. */
export default function TemplatesPage() {
  const features = useFeatures();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <PageHeader title="Templates" subtitle="Pick a ready-made Reel, add your clips: the style, look, length and text are done for you." />
      {GROUPS.map((g) => {
        const list = STUDIO_TEMPLATES.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={g} className="flex flex-col gap-2.5">
            <h2 className="ht">{g}</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {list.map((t) => (
                <TemplateCard key={t.id} t={t} />
              ))}
            </div>
          </section>
        );
      })}
      {features.templates && <ServerTemplates />}
    </div>
  );
}
