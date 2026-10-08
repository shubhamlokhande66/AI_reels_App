"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { btnDanger, btnPrimary, btnSecondary, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from "@/components/ui";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { STYLE_LABELS } from "@/lib/format";
import { BRAND_VISUAL_STYLES, LANGUAGES, type Brand, type BrandInput, type Language } from "@/types/api";

const FIELD = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";
const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];
const POSITIONS = [
  ["br", "Bottom right"],
  ["bl", "Bottom left"],
  ["tr", "Top right"],
  ["tl", "Top left"],
  ["center", "Center"],
] as const;

const EMPTY: BrandInput = {
  name: "",
  colors: { primary: "#FFFFFF", secondary: "#111111", accent: "#D4B07A" },
  captionFont: null,
  headingFont: null,
  watermark: { enabled: true, position: "br", opacity: 0.85, scale: 0.16 },
  cta: "",
  language: "en",
  voiceProfileId: null,
  scriptTone: "",
  captionStyle: "minimal",
  style: "auto",
  visualStyle: null,
  pace: "balanced",
  trendId: null,
  musicStyle: "",
  exportPreset: "instagram_reel",
};

export default function BrandsPage() {
  const qc = useQueryClient();
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.brands });
  const voices = useQuery({ queryKey: ["voices"], queryFn: api.voices });
  const [editing, setEditing] = useState<{ id: string | null; data: BrandInput; logoUrl: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return null;
      let b: Brand = editing.id ? await api.updateBrand(editing.id, editing.data) : await api.createBrand(editing.data);
      if (logoFile) b = await api.uploadLogo(b.id, logoFile);
      return b;
    },
    onSuccess: () => {
      setEditing(null);
      setLogoFile(null);
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });
  const del = useMutation({ mutationFn: api.deleteBrand, onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }) });
  const set = <K extends keyof BrandInput>(k: K, v: BrandInput[K]) => setEditing((e) => e && { ...e, data: { ...e.data, [k]: v } });
  const color = (k: keyof BrandInput["colors"], label: string) =>
    editing && (
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted">{label}</span>
        <input
          type="color"
          aria-label={`${label} colour`}
          value={editing.data.colors[k]}
          onChange={(e) => set("colors", { ...editing.data.colors, [k]: e.target.value.toUpperCase() })}
          className="h-9 w-full cursor-pointer rounded-lg border border-border bg-surface"
        />
      </label>
    );

  return (
    <>
      <PageHeader
        title="Brands"
        subtitle="A brand is a look and a set of defaults. Apply it to any project."
        action={
          <button type="button" className={btnPrimary} onClick={() => { setLogoFile(null); setEditing({ id: null, data: EMPTY, logoUrl: null }); }}>
            ＋ New brand
          </button>
        }
      />
      {brands.isLoading && <Spinner />}
      {brands.error && <ErrorBanner message={errorMessage(brands.error)} />}
      {brands.data && brands.data.length === 0 && !editing && <EmptyState title="No brands yet" hint="Add your logo, colours and defaults once and reuse them." />}

      <div className="grid gap-4 md:grid-cols-2">
        {brands.data?.map((b) => (
          <Card key={b.id}>
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border" style={{ background: b.colors.secondary }}>
                {b.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(b.logoUrl)} alt={`${b.name} logo`} className="max-h-14 max-w-14 object-contain" />
                ) : (
                  <span className="text-xs" style={{ color: b.colors.primary }}>{b.name.slice(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="truncate font-medium">{b.name}</h3>
                <div className="mt-1 flex gap-1" aria-label="Brand colours">
                  {Object.values(b.colors).map((c) => (
                    <span key={c} className="h-4 w-4 rounded-full border border-border" style={{ background: c }} title={c} />
                  ))}
                </div>
                <p className="mt-1 truncate text-xs text-muted">
                  {LANGUAGES.find((l) => l.id === b.language)?.label} · {b.captionStyle} captions · {STYLE_LABELS[b.style] ?? b.style}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => { setLogoFile(null); setEditing({ id: b.id, data: { ...b }, logoUrl: b.logoUrl }); }}>
                Edit
              </button>
              <button type="button" className={btnDanger} onClick={() => window.confirm(`Delete brand "${b.name}"?`) && del.mutate(b.id)}>
                Delete
              </button>
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <Card className="mt-6">
          <form
            aria-label="Brand"
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <h2 className="font-medium">{editing.id ? "Edit brand" : "New brand"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Brand name</span>
                <input required maxLength={80} className={FIELD} value={editing.data.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. NAMORA" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Call to action (shown at the end)</span>
                <input maxLength={100} className={FIELD} value={editing.data.cta} onChange={(e) => set("cta", e.target.value)} placeholder="Shop the collection" />
              </label>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs text-muted">Colours</legend>
              <div className="grid grid-cols-3 gap-3">
                {color("primary", "Primary (captions)")}
                {color("secondary", "Secondary")}
                {color("accent", "Accent")}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs text-muted">Logo &amp; watermark</legend>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  aria-label="Logo file"
                  className="text-sm"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                />
                {editing.logoUrl && !logoFile && <span className="text-xs text-success">✓ logo uploaded</span>}
                {logoFile && <span className="text-xs text-muted">{logoFile.name} will be uploaded on save</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.data.watermark.enabled} onChange={(e) => set("watermark", { ...editing.data.watermark, enabled: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
                  Show watermark
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted">Position</span>
                  <select className={FIELD} value={editing.data.watermark.position} onChange={(e) => set("watermark", { ...editing.data.watermark, position: e.target.value as Brand["watermark"]["position"] })}>
                    {POSITIONS.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted">Opacity · {Math.round(editing.data.watermark.opacity * 100)}%</span>
                  <input type="range" aria-label="Watermark opacity" min={0.1} max={1} step={0.05} value={editing.data.watermark.opacity} onChange={(e) => set("watermark", { ...editing.data.watermark, opacity: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
                </label>
              </div>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-xs text-muted">Defaults for new Reels</legend>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Language</span>
                <select className={FIELD} value={editing.data.language} onChange={(e) => set("language", e.target.value as Language)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Voice</span>
                <select className={FIELD} value={editing.data.voiceProfileId ?? ""} onChange={(e) => set("voiceProfileId", e.target.value || null)}>
                  <option value="">None</option>
                  {voices.data?.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Caption style</span>
                <select className={FIELD} value={editing.data.captionStyle} onChange={(e) => set("captionStyle", e.target.value)}>
                  {CAPTION_STYLES.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Edit style</span>
                <select className={FIELD} value={editing.data.style} onChange={(e) => set("style", e.target.value)}>
                  {Object.entries(STYLE_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Pace</span>
                <select className={FIELD} value={editing.data.pace} onChange={(e) => set("pace", e.target.value as BrandInput["pace"])}>
                  {["calm", "balanced", "fast"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Brand look (used when a project style is auto)</span>
                <select
                  className={FIELD}
                  value={editing.data.visualStyle ?? ""}
                  onChange={(e) => set("visualStyle", (e.target.value || null) as BrandInput["visualStyle"])}
                >
                  <option value="">none</option>
                  {BRAND_VISUAL_STYLES.map((v) => (
                    <option key={v} value={v}>
                      {v.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted">Script tone</span>
                <input maxLength={80} className={FIELD} value={editing.data.scriptTone} onChange={(e) => set("scriptTone", e.target.value)} placeholder="warm, elegant" />
              </label>
              <label className="text-sm sm:col-span-3">
                <span className="mb-1 block text-xs text-muted">Music style (a note for choosing tracks)</span>
                <input maxLength={100} className={FIELD} value={editing.data.musicStyle} onChange={(e) => set("musicStyle", e.target.value)} placeholder="warm acoustic, no vocals" />
              </label>
            </fieldset>

            {save.error && <ErrorBanner message={errorMessage(save.error)} />}
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={save.isPending || !editing.data.name.trim()}>
                {save.isPending ? "Saving…" : "Save brand"}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
