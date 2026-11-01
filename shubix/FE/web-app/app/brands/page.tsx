"use client";

import { PlanGate } from "@/components/organisms/PlanGate";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Heading, IconButton, Input, Select, Spinner, Toggle } from "@/components/atoms";
import { EmptyState, ErrorBanner, Field, PageHeader, SidePanel } from "@/components/molecules";
import { api, assetUrl, errorMessage } from "@/lib/api";
import { STYLE_LABELS } from "@/lib/format";
import { useText } from "@/hooks/useApi";
import { BRAND_VISUAL_STYLES, LANGUAGES, type Brand, type BrandInput, type Language } from "@/types/api";
import { confirmAction } from "@/components/molecules/ConfirmDialog";

const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];
// watermark positions and paces: their names are texts (Admin → CMS → Brands)
const POSITIONS = [["br", "brands.posBR"], ["bl", "brands.posBL"], ["tr", "brands.posTR"], ["tl", "brands.posTL"], ["center", "brands.posC"]] as const;
const PACES = [["calm", "brands.paceCalm"], ["balanced", "brands.paceBalanced"], ["fast", "brands.paceFast"]] as const;

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
  return (
    <PlanGate item="page:brand">
      <Brands />
    </PlanGate>
  );
}

function Brands() {
  const qc = useQueryClient();
  const text = useText();
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.brands });
  const voices = useQuery({ queryKey: ["voices"], queryFn: api.voices });
  const [editing, setEditing] = useState<{ id: string | null; data: BrandInput; logoUrl: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const save = useMutation({ meta: { success: "Brand saved", errorShown: true },
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
  const del = useMutation({ meta: { success: "Brand deleted" }, mutationFn: api.deleteBrand, onSuccess: () => qc.invalidateQueries({ queryKey: ["brands"] }) });
  const set = <K extends keyof BrandInput>(k: K, v: BrandInput[K]) => setEditing((e) => e && { ...e, data: { ...e.data, [k]: v } });
  const color = (k: keyof BrandInput["colors"], label: string) =>
    editing && (
      <label className="relative h-[26px] w-[26px] shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-surface shadow-[0_0_0_1px_var(--border)]" style={{ background: editing.data.colors[k] }} title={label}>
        <input type="color" aria-label={label} value={editing.data.colors[k]} onChange={(e) => set("colors", { ...editing.data.colors, [k]: e.target.value.toUpperCase() })} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    );
  const startNew = () => {
    setLogoFile(null);
    setEditing({ id: null, data: EMPTY, logoUrl: null });
  };
  const list = brands.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageHeader title={text("nav.myBrands")} subtitle={text("brands.sub")} action={list.length > 0 ? <Button size="sm" icon="plus" onClick={startNew}>{text("brands.new")}</Button> : undefined} />
      {brands.isLoading && <Spinner />}
      {brands.error && <ErrorBanner message={errorMessage(brands.error)} onRetry={() => brands.refetch()} />}
      {brands.data && list.length === 0 && (
        <EmptyState icon="star" title={text("brands.none")} hint={text("brands.sub")} action={<Button onClick={startNew}>{text("brands.create")}</Button>} />
      )}

      {list.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((b) => (
            <Card key={b.id} as="article" aria-label={b.name} className="flex flex-col gap-0 overflow-hidden p-0 md:p-0">
              {/* the brand's look: its background, its logo (else its initials) and its colours */}
              <div className="relative grid h-28 place-items-center" style={{ background: b.colors.secondary }}>
                {b.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assetUrl(b.logoUrl)} alt={`${b.name} logo`} className="max-h-16 max-w-[60%] object-contain" />
                ) : (
                  <span className="font-[family-name:var(--font-display)] text-[28px] font-semibold tracking-[-0.02em]" style={{ color: b.colors.primary }}>{b.name.slice(0, 2).toUpperCase()}</span>
                )}
                <span className="absolute bottom-2 right-2 flex gap-1 rounded-full bg-black/35 p-1" aria-label={text("brands.colours")}>
                  {Object.values(b.colors).map((c) => <span key={c} className="h-3.5 w-3.5 rounded-full border border-white/40" style={{ background: c }} title={c} />)}
                </span>
              </div>
              <div className="flex flex-col gap-1 p-3.5">
                <b className="truncate text-[14.5px]">{b.name}</b>
                <span className="truncate text-[12px] text-muted">{LANGUAGES.find((l) => l.id === b.language)?.label} · {text("brands.captions", { style: b.captionStyle })}</span>
              </div>
              <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
                <Button size="sm" variant="ghost" icon="pen" onClick={() => { setLogoFile(null); setEditing({ id: b.id, data: { ...b }, logoUrl: b.logoUrl }); }}>{text("brands.edit")}</Button>
                <IconButton icon="trash" plain size={34} iconSize={16} label={`${text("reels.delete")} ${b.name}`} className="ml-auto text-danger"
                  onClick={() => void confirmAction({ title: text("brands.deleteTitle", { name: b.name }), body: text("brands.deleteText"), danger: true, ok: text("reels.delete") }).then((ok) => ok && del.mutate(b.id))} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <SidePanel open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? text("brands.details") : text("brands.newTitle")} where={text("nav.myBrands")}>
      {editing && (
        <Card as="section" aria-label={editing.id ? text("brands.details") : text("brands.newTitle")}>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Field label={text("brands.name")}>
              <Input required maxLength={80} value={editing.data.name} onChange={(e) => set("name", e.target.value)} placeholder={text("brands.namePlaceholder")} />
            </Field>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-muted">{text("brands.coloursLabel")}</span>
              <span className="flex items-center gap-1.5">
                {color("primary", text("brands.main"))}
                {color("secondary", text("brands.background"))}
                {color("accent", text("brands.accent"))}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] font-semibold text-muted">{text("brands.logo")}</span>
              <span className="flex min-w-0 items-center gap-3">
                {logoFile ? <span className="truncate text-[11px] text-muted">{logoFile.name}</span> : editing.logoUrl ? <span className="text-[11px] text-success">{text("brands.logoAdded")}</span> : null}
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>{editing.logoUrl || logoFile ? text("brands.changeLogo") : text("brands.chooseLogo")}</Button>
              </span>
              <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" aria-label={text("brands.logo")} className="sr-only" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={text("brands.position")}>
                <Select value={editing.data.watermark.position} onChange={(e) => set("watermark", { ...editing.data.watermark, position: e.target.value as Brand["watermark"]["position"] })}>
                  {POSITIONS.map(([v, k]) => <option key={v} value={v}>{text(k)}</option>)}
                </Select>
              </Field>
              <Field label={text("brands.opacity", { n: Math.round(editing.data.watermark.opacity * 100) })}>
                <input type="range" min={0.1} max={1} step={0.05} value={editing.data.watermark.opacity} onChange={(e) => set("watermark", { ...editing.data.watermark, opacity: Number(e.target.value) })} className="h-11 accent-[var(--accent)]" />
              </Field>
            </div>
            <Toggle label={text("brands.showLogo")} on={editing.data.watermark.enabled} onChange={(v) => set("watermark", { ...editing.data.watermark, enabled: v })} />

            <Heading size="section" className="mt-1">{text("brands.defaults")}</Heading>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={text("brands.style")}>
                <Select value={editing.data.style} onChange={(e) => set("style", e.target.value)}>
                  {Object.entries(STYLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </Select>
              </Field>
              <Field label={text("brands.captionsLabel")}>
                <Select className="capitalize" value={editing.data.captionStyle} onChange={(e) => set("captionStyle", e.target.value)}>
                  {CAPTION_STYLES.map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label={text("brands.language")}>
                <Select value={editing.data.language} onChange={(e) => set("language", e.target.value as Language)}>
                  {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                </Select>
              </Field>
              <Field label={text("brands.tone")}>
                <Input maxLength={80} value={editing.data.scriptTone} onChange={(e) => set("scriptTone", e.target.value)} placeholder={text("brands.tonePlaceholder")} />
              </Field>
            </div>
            <details className="text-[12.5px]">
              <summary className="cursor-pointer font-bold text-accent">{text("brands.more")}</summary>
              <div className="mt-3 flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label={text("brands.voice")}>
                    <Select value={editing.data.voiceProfileId ?? ""} onChange={(e) => set("voiceProfileId", e.target.value || null)}>
                      <option value="">{text("brands.none2")}</option>
                      {voices.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </Select>
                  </Field>
                  <Field label={text("brands.pace")}>
                    <Select value={editing.data.pace} onChange={(e) => set("pace", e.target.value as BrandInput["pace"])}>
                      {PACES.map(([v, k]) => <option key={v} value={v}>{text(k)}</option>)}
                    </Select>
                  </Field>
                </div>
                <Field label={text("brands.look")}>
                  <Select className="capitalize" value={editing.data.visualStyle ?? ""} onChange={(e) => set("visualStyle", (e.target.value || null) as BrandInput["visualStyle"])}>
                    <option value="">{text("brands.none2")}</option>
                    {BRAND_VISUAL_STYLES.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
                  </Select>
                </Field>
                <Field label={text("brands.cta")}>
                  <Input maxLength={100} value={editing.data.cta} onChange={(e) => set("cta", e.target.value)} placeholder={text("brands.ctaPlaceholder")} />
                </Field>
                <Field label={text("brands.music")}>
                  <Input maxLength={100} value={editing.data.musicStyle} onChange={(e) => set("musicStyle", e.target.value)} placeholder={text("brands.musicPlaceholder")} />
                </Field>
              </div>
            </details>

            {save.error && <ErrorBanner message={errorMessage(save.error)} />}
            <div className="grid grid-cols-2 gap-2.5">
              <Button variant="secondary" onClick={() => setEditing(null)}>{text("brands.cancel")}</Button>
              <Button type="submit" loading={save.isPending} disabled={!editing.data.name.trim()}>{save.isPending ? text("brands.saving") : text("brands.save")}</Button>
            </div>
          </form>
        </Card>
      )}
      </SidePanel>
    </div>
  );
}
