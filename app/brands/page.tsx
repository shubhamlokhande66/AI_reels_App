"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon, Spinner, Toggle } from "@/components/atoms";
import { EmptyState, ErrorBanner, PageHeader } from "@/components/molecules";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { STYLE_LABELS } from "@/lib/format";
import { BRAND_VISUAL_STYLES, LANGUAGES, type Brand, type BrandInput, type Language } from "@/types/api";

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
      <label className="sw relative cursor-pointer overflow-hidden" style={{ background: editing.data.colors[k] }} title={label}>
        <input
          type="color"
          aria-label={`${label} colour`}
          value={editing.data.colors[k]}
          onChange={(e) => set("colors", { ...editing.data.colors, [k]: e.target.value.toUpperCase() })}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    );
  const startNew = () => {
    setLogoFile(null);
    setEditing({ id: null, data: EMPTY, logoUrl: null });
  };
  const list = brands.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <PageHeader title="My Brands" subtitle="A brand is a look and a set of defaults. Apply it to any project." action={list.length > 0 && !editing ? <button type="button" className="btn g sm" onClick={startNew}>+ New brand</button> : undefined} />
      {brands.isLoading && <Spinner />}
      {brands.error && <ErrorBanner message={errorMessage(brands.error)} onRetry={() => brands.refetch()} />}
      {brands.data && list.length === 0 && !editing && (
        <EmptyState icon="star" title="No brands yet" hint="A brand is a look and a set of defaults. Apply it to any project." action={<button type="button" className="btn g" onClick={startNew}>Create brand</button>} />
      )}

      {list.map((b) => (
        <div key={b.id} className="lr">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border" style={{ background: b.colors.secondary }}>
            {b.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(b.logoUrl)} alt={`${b.name} logo`} className="max-h-10 max-w-10 object-contain" />
            ) : (
              <span className="text-xs font-bold" style={{ color: b.colors.primary }}>{b.name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <span className="meta">
            <b>{b.name}</b>
            <span className="row" style={{ gap: 4 }} aria-label="Brand colours">
              {Object.values(b.colors).map((c) => (
                <span key={c} className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: c }} title={c} />
              ))}
              <span className="mu xs ml-1 truncate">
                {LANGUAGES.find((l) => l.id === b.language)?.label} · {b.captionStyle} captions
              </span>
            </span>
          </span>
          <button type="button" className="btn sm" onClick={() => { setLogoFile(null); setEditing({ id: b.id, data: { ...b }, logoUrl: b.logoUrl }); }}>
            Edit
          </button>
          <button type="button" className="ib plain" aria-label={`Delete ${b.name}`} onClick={() => window.confirm(`Delete the brand "${b.name}"?`) && del.mutate(b.id)}>
            <Icon name="trash" size={18} />
          </button>
        </div>
      ))}

      {editing && (
        <form
          aria-label="Brand"
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <span className="h2">{editing.id ? "Brand details" : "New brand"}</span>
          <label className="f">
            Brand name
            <input required maxLength={80} className="inp" value={editing.data.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Shubix" />
          </label>
          <div className="between">
            <span className="f">Colours</span>
            <span className="row" style={{ gap: 6 }}>
              {color("primary", "Main (captions)")}
              {color("secondary", "Background")}
              {color("accent", "Accent")}
            </span>
          </div>
          <div className="between">
            <span className="f">Logo</span>
            <span className="row min-w-0">
              {logoFile ? <span className="mu xs truncate">{logoFile.name}</span> : editing.logoUrl ? <span className="xs text-success">Logo added</span> : null}
              <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
                {editing.logoUrl || logoFile ? "Change logo" : "Choose logo file"}
              </button>
            </span>
            <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" aria-label="Logo file" className="sr-only" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="g2">
            <label className="f">
              Watermark position
              <select className="inp" value={editing.data.watermark.position} onChange={(e) => set("watermark", { ...editing.data.watermark, position: e.target.value as Brand["watermark"]["position"] })}>
                {POSITIONS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="f">
              Opacity · {Math.round(editing.data.watermark.opacity * 100)}%
              <input type="range" aria-label="Watermark opacity" min={0.1} max={1} step={0.05} value={editing.data.watermark.opacity} onChange={(e) => set("watermark", { ...editing.data.watermark, opacity: Number(e.target.value) })} style={{ height: 44, accentColor: "var(--accent)" }} />
            </label>
          </div>
          <Toggle label="Show the logo on every Reel" on={editing.data.watermark.enabled} onChange={(v) => set("watermark", { ...editing.data.watermark, enabled: v })} />

          <span className="h2 mt-1">Defaults for new Reels</span>
          <div className="g2">
            <label className="f">
              Edit style
              <select className="inp" value={editing.data.style} onChange={(e) => set("style", e.target.value)}>
                {Object.entries(STYLE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
            <label className="f">
              Captions
              <select className="inp capitalize" value={editing.data.captionStyle} onChange={(e) => set("captionStyle", e.target.value)}>
                {CAPTION_STYLES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="g2">
            <label className="f">
              Language
              <select className="inp" value={editing.data.language} onChange={(e) => set("language", e.target.value as Language)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </label>
            <label className="f">
              Script tone
              <input maxLength={80} className="inp" value={editing.data.scriptTone} onChange={(e) => set("scriptTone", e.target.value)} placeholder="Warm" />
            </label>
          </div>
          <details className="sm">
            <summary className="ac cursor-pointer font-bold">More defaults</summary>
            <div className="mt-3 flex flex-col gap-2.5">
              <div className="g2">
                <label className="f">
                  Voice
                  <select className="inp" value={editing.data.voiceProfileId ?? ""} onChange={(e) => set("voiceProfileId", e.target.value || null)}>
                    <option value="">None</option>
                    {voices.data?.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </label>
                <label className="f">
                  Pace
                  <select className="inp capitalize" value={editing.data.pace} onChange={(e) => set("pace", e.target.value as BrandInput["pace"])}>
                    {["calm", "balanced", "fast"].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="f">
                Brand look (when a project&apos;s style is automatic)
                <select className="inp capitalize" value={editing.data.visualStyle ?? ""} onChange={(e) => set("visualStyle", (e.target.value || null) as BrandInput["visualStyle"])}>
                  <option value="">None</option>
                  {BRAND_VISUAL_STYLES.map((v) => (
                    <option key={v} value={v}>{v.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
              <label className="f">
                Call to action at the end
                <input maxLength={100} className="inp" value={editing.data.cta} onChange={(e) => set("cta", e.target.value)} placeholder="Shop the collection" />
              </label>
              <label className="f">
                Music style
                <input maxLength={100} className="inp" value={editing.data.musicStyle} onChange={(e) => set("musicStyle", e.target.value)} placeholder="Warm acoustic, no vocals" />
              </label>
            </div>
          </details>

          {save.error && <ErrorBanner message={errorMessage(save.error)} />}
          <div className="g2">
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="btn g" disabled={save.isPending || !editing.data.name.trim()}>
              {save.isPending ? "Saving…" : "Save brand"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
