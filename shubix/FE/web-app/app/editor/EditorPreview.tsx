"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const categories = ["Media", "Stickers", "Filters", "Style", "Shots", "Music", "Text", "Captions", "Background", "Layers", "Voice", "Motion"];
const tools = ["Transition", "Effect", "Speed", "Split", "Duplicate", "Freeze", "Other moment", "Volume", "Extract audio", "Crop", "Reverse", "Rotate", "Mirror", "Flip", "Fit", "Canvas", "Border", "Adjust", "Speed curve", "Stabilize", "Beauty", "Fade", "Mosaic", "Magnifier", "Slip", "Trim", "Reset", "Delete"];
const options: Record<string, string[]> = {
  Media: ["Your clips", "Upload media", "Recent", "Stock library"], Stickers: ["Trending", "Emoji", "Shapes", "Recently used"], Filters: ["Original", "Golden", "Warm film", "Soft fade", "Noir"], Style: ["Auto edit", "Smooth", "Fast cuts", "Cinematic"], Shots: ["Beat sync", "Even pacing", "Long moments", "Short cuts"], Music: ["Choose a song", "My library", "Trending", "Extracted audio"], Text: ["Title", "Subtitle", "Callout", "Brand text"], Captions: ["Auto captions", "Caption style", "Upload SRT", "Translate"], Background: ["Blur fill", "Solid color", "Gradient", "Image"], Layers: ["Add a layer", "Arrange", "Blend mode", "Opacity"], Voice: ["Record voice", "Voiceover", "Clean audio", "Text to speech"], Motion: ["Pan & zoom", "Smooth camera", "Tracking", "Keyframes"],
  Transition: ["None", "Fade", "Dissolve", "Swipe", "Zoom", "Blur", "Glitch"], Effect: ["None", "Film grain", "Soft glow", "Vintage", "VHS", "RGB split", "Light leak"], Speed: ["0.25×", "0.5×", "0.75×", "1×", "1.5×", "2×", "4×"], Split: ["At playhead", "Split in half", "Split into thirds"], Duplicate: ["Duplicate once", "Duplicate twice", "Copy to end"], Freeze: ["Current frame", "Choose a frame", "Freeze duration"], "Other moment": ["Find best moment", "Earlier moment", "Later moment", "Choose frame"], Volume: ["Mute", "25%", "50%", "75%", "100%", "150%"], "Extract audio": ["Extract audio", "Keep video sound", "Extract voice"], Crop: ["Original", "9:16 portrait", "1:1 square", "16:9 wide", "Free crop"], Reverse: ["Reverse clip", "Reverse selection", "Preview reverse"], Rotate: ["90° clockwise", "180°", "90° counter-clockwise"], Mirror: ["Horizontal mirror", "Vertical mirror"], Flip: ["Flip horizontal", "Flip vertical"], Fit: ["Fit", "Fill", "Stretch"], Canvas: ["9:16 Reel", "1:1 Square", "4:5 Portrait", "16:9 Landscape"], Border: ["No border", "Fine line", "Soft edge", "Film frame"], Adjust: ["Exposure", "Contrast", "Temperature", "Saturation", "Highlights"], "Speed curve": ["Montage", "Hero moment", "Bullet", "Smooth", "Custom curve"], Stabilize: ["Off", "Light", "Balanced", "Strong"], Beauty: ["Off", "Natural", "Soft", "Smooth"], Fade: ["Fade in", "Fade out", "Fade both", "No fade"], Mosaic: ["Pixel mosaic", "Soft blur", "Circle mask", "Custom area"], Magnifier: ["1.2×", "1.5×", "2×", "Choose area"], Slip: ["Earlier frames", "Later frames", "Center selection"], Trim: ["Trim start", "Trim end", "Fine trim"], Reset: ["Reset effects", "Reset framing", "Reset speed", "Reset all"], Delete: ["Keep this shot", "Remove shot"],
};
const paths: Record<string, string> = { Media: "M4 5h16v14H4zM8 15l3-3 2 2 2-3 3 4", Stickers: "M12 3a9 9 0 1 0 9 9h-6a3 3 0 0 1-3-3zM15 3v5h5", Filters: "M4 6h16M7 12h10M10 18h4", Style: "m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3z", Shots: "M4 4h16v16H4zM8 4v16M16 4v16", Music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3", Text: "M4 6V4h16v2M12 4v16", Captions: "M4 5h16v14H4zM7 10h4M13 10h4M7 14h3", Background: "M4 6h16v12H4zM7 15l3-3 2 2 3-4", Layers: "m12 3 9 5-9 5-9-5zM3 12l9 5 9-5", Voice: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6M6 10v1a6 6 0 0 0 12 0v-1", Motion: "M4 12h4l2-7 4 14 2-7h4", Transition: "M4 6l7 6-7 6zM20 6l-7 6 7 6z", Effect: "m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3z", Speed: "M12 3v9l6 3", Split: "M12 3v18M5 8l7 4 7-4M5 16l7-4 7 4", Duplicate: "M8 8h12v12H8zM4 16V4h12", Freeze: "M12 3v18M4 7l16 10M4 17 20 7", Volume: "M4 10v4h4l5 4V6l-5 4zM17 9a5 5 0 0 1 0 6", Crop: "M6 3v15a3 3 0 0 0 3 3h12M3 6h15a3 3 0 0 1 3 3", play: "M8 5v14l11-7z" };

// ---- the editor's look, in Tailwind (was editor.module.css). Breakpoints: ≤900px stacks the panels, ≤680px is the phone.
/** the editor's own line colour (--ed-line), set on the editor and on its option sheet (a portal outside it) */
const ED_LINE = "[--ed-line:color-mix(in_srgb,var(--accent)_14%,var(--border))]";
const PANEL = "border border-(--ed-line) bg-[linear-gradient(145deg,color-mix(in_srgb,var(--surface)_97%,var(--accent)),var(--surface))] shadow-(--shadow)";
const EASE = "duration-[180ms] ease-[ease]";
/** a small framed button (the project bar, the preview header, the timeline) */
const FRAMED = `inline-flex cursor-pointer items-center justify-center gap-[7px] border border-(--ed-line) bg-[color:color-mix(in_srgb,var(--surface-2)_70%,var(--surface))] text-foreground transition-[transform,border-color,background,box-shadow] ${EASE} enabled:hover:-translate-y-px enabled:hover:border-[color:color-mix(in_srgb,var(--accent)_45%,var(--border))]`;
const GOLD = "bg-gold text-on-accent";
const GREEN_DOT = "inline-block size-1.5 flex-none rounded-full bg-[#72bd91] shadow-[0_0_10px_color-mix(in_srgb,#72bd91_55%,transparent)]";
const EYEBROW = "flex items-center gap-[7px] text-[9px] font-[750] tracking-[.13em] text-muted";
const TILE_ICON = "grid flex-none place-items-center text-accent";
/** the mono type sizes (written out: Tailwind only sees classes spelled in full) */
const MONO = { "7b": "[font:700_7px_var(--font-geist-mono),monospace]", "9": "[font:9px_var(--font-geist-mono),monospace]", "9b": "[font:600_9px_var(--font-geist-mono),monospace]", "10b": "[font:600_10px_var(--font-geist-mono),monospace]", "11": "[font:11px_var(--font-geist-mono),monospace]" };
/** the light strip behind the Effects / Text / Voice / Music tracks */
const TRACK_BED = "before:absolute before:inset-x-0 before:inset-y-1.5 before:rounded-lg before:bg-[color:color-mix(in_srgb,var(--surface-2)_62%,transparent)] before:content-['']";
const SCENES = [
  "bg-[linear-gradient(155deg,#e0b282_0%,#627f79_48%,#2e413e_100%)]",
  "bg-[linear-gradient(155deg,#efbc86,#718988_49%,#34433d)]",
  "bg-[linear-gradient(155deg,#b7b5a4,#66837a_52%,#3c4942)]",
  "bg-[linear-gradient(155deg,#e5b785,#a97c5e_48%,#343b35)]",
];
const CITY = [
  "h-[54%] w-[17%] bg-[linear-gradient(90deg,#3c4240,#4d5148)]",
  "h-[78%] w-[20%] bg-[linear-gradient(90deg,#4c4b40,#605746)]",
  "h-[66%] w-[17%] bg-[linear-gradient(90deg,#303b3a,#46504a)]",
  "h-[90%] w-[21%] bg-[linear-gradient(90deg,#565044,#695d4b)]",
  "h-[47%] w-[17%] bg-[linear-gradient(90deg,#3c4240,#4d5148)]",
];
/** the transition previews: what changes in each (the two frames and the arrow) */
const TRANSITION_FX: { first?: string; arrow?: string; last?: string }[] = [{}, { first: "opacity-50" }, { arrow: "opacity-[.48]" }, { last: "-translate-x-[5px]" }, { first: "scale-[.8]" }, { last: "blur-[2px]" }, { arrow: "[text-shadow:2px_0_#d46565,-2px_0_#6685bc]" }];
const EFFECT_FX = ["", "saturate-[1.3] sepia-[.13]", "shadow-[0_0_18px_4px_rgba(244,212,150,.3)_inset]", "saturate-[.65] contrast-[1.12]"];

function Glyph({ name, size = 18 }: { name: string; size?: number }) {
  const d = paths[name] ?? "m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3z";
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function Waveform({ compact = false, className, bar = "bg-[color:color-mix(in_srgb,var(--accent)_88%,white)]" }: { compact?: boolean; className?: string; bar?: string }) {
  return <span className={cn("absolute inset-0 flex items-center justify-around gap-0.5 overflow-hidden px-1.5 py-[3px]", className)} aria-hidden="true">{Array.from({ length: compact ? 48 : 100 }, (_, i) => <i key={i} className={cn("w-0.5 min-w-0.5 rounded opacity-80", bar)} style={{ height: `${(18 + Math.abs(Math.sin(i * .41) * Math.cos(i * .13)) * 78).toFixed(2)}%` }} />)}</span>;
}

export function EditorPreview({ projectId }: { projectId?: string } = {}) {
  const [category, setCategory] = useState("Style");
  const [tool, setTool] = useState("Transition");
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [shot, setShot] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(100);
  useEffect(() => { if (!open) return; const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, [open]);
  const choices = open ? options[open] ?? [] : [];
  const pro = ["Background", "Layers", "Voice", "Motion"];
  const shotNo = String(shot + 1).padStart(2, "0");
  const trackLabel = "flex min-w-0 items-center gap-1.5 border-b border-[color:color-mix(in_srgb,var(--border)_65%,transparent)] pr-1.5 pl-2 text-[10px] font-semibold text-muted [&_svg]:flex-none [&_svg]:text-accent max-[680px]:gap-[5px] max-[680px]:pl-[5px] max-[680px]:text-[9px]";
  const rowGrid = "grid grid-cols-[114px_minmax(0,1fr)] gap-2 max-[680px]:grid-cols-[92px_minmax(0,1fr)] max-[680px]:gap-1.5";
  return <main className={cn(ED_LINE, "grid w-full gap-4 font-[family-name:var(--font-body),Manrope,sans-serif] text-foreground max-[900px]:grid-cols-[minmax(0,1fr)] max-[680px]:flex max-[680px]:flex-col max-[680px]:gap-3 max-[680px]:pb-3 motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none")}>
    <header className={cn(PANEL, "flex min-h-[66px] items-center justify-between gap-3.5 rounded-[18px] px-3.5 py-2.5 max-[680px]:order-0 max-[680px]:min-h-[58px] max-[680px]:gap-2 max-[680px]:rounded-[15px] max-[680px]:px-2.5 max-[680px]:py-2")}>
      <div className="flex min-w-0 items-center gap-[11px]">
        <span className={cn(TILE_ICON, "size-10 rounded-[13px] border border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface))] max-[680px]:size-[34px] max-[680px]:rounded-[11px]")}><Glyph name="Shots" /></span>
        <span className="flex min-w-0 flex-col items-start gap-[3px]">
          <small className={cn(EYEBROW, "max-[680px]:text-[7px] max-[380px]:gap-[5px] max-[380px]:text-[6px] max-[380px]:tracking-[.1em]")}>REEL STUDIO <i className={GREEN_DOT} /> {projectId ? `PROJECT ${projectId}` : "INTERACTIVE PREVIEW"}</small>
          <strong className="max-w-[34ch] truncate [font:600_15px/1.2_var(--font-display),var(--font-body),sans-serif] tracking-[-.02em] text-foreground max-[680px]:max-w-[22ch] max-[680px]:text-[13px] max-[380px]:max-w-[17ch] max-[380px]:text-[12px]">Golden hour memories</strong>
        </span>
      </div>
      <div className="flex flex-none items-center gap-[7px] max-[680px]:gap-[3px]">
        {(["↶", "↷"] as const).map((g, i) => <button key={g} aria-label={i ? "Redo" : "Undo"} className={`inline-flex size-[34px] cursor-pointer items-center justify-center border-0 bg-transparent [font:22px/1_var(--font-body),sans-serif] text-muted transition-transform ${EASE} enabled:hover:-translate-y-px disabled:cursor-default disabled:opacity-[.48] max-[680px]:hidden`}>{g}</button>)}
        <button className={cn(FRAMED, "h-9 rounded-[11px] px-[13px] [font:600_12px_var(--font-body),sans-serif] max-[680px]:hidden")}><Glyph name="Transition" /> Share</button>
        <button className={cn(FRAMED, GOLD, "h-9 rounded-[11px] border-transparent px-[13px] [font:600_12px_var(--font-body),sans-serif] shadow-[0_9px_18px_-13px_var(--brand-glow)] max-[680px]:h-[34px] max-[680px]:px-2.5 max-[680px]:text-[11px]")}>Export <Glyph name="Transition" /></button>
      </div>
    </header>

    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(290px,340px)] gap-4 max-[900px]:contents">
      <section className={cn(PANEL, "grid min-h-[520px] min-w-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden rounded-[19px] p-3.5 max-[900px]:order-1 max-[900px]:min-h-[480px] max-[900px]:p-3 max-[680px]:min-h-0 max-[680px]:grid-rows-[auto_minmax(280px,68svh)_auto_auto] max-[680px]:rounded-2xl max-[680px]:p-2.5 max-[380px]:grid-rows-[auto_minmax(260px,64svh)_auto_auto]")}>
        <div className="flex items-center justify-between text-[9px] font-extrabold tracking-[.13em] text-muted">
          <span className="inline-flex items-center gap-2"><i className="inline-block size-[7px] flex-none rounded-full bg-accent shadow-[0_0_12px_var(--brand-glow)]" /> PREVIEW</span>
          <button className={cn(FRAMED, "min-h-[30px] rounded-[9px] px-2.5 [font:600_11px_var(--font-body),sans-serif]")}>9:16 <span className="text-[14px] text-muted">⌄</span></button>
        </div>
        <div className="grid min-h-0 place-items-center p-3 max-[680px]:px-0 max-[680px]:py-2.5">
          <div className="relative isolate aspect-[9/16] h-[min(100%,364px)] w-[min(100%,238px)] overflow-hidden rounded-[17px] border border-white/15 bg-[#23251f] shadow-[0_22px_50px_-24px_rgba(0,0,0,.75),0_0_0_5px_color-mix(in_srgb,var(--accent)_7%,transparent)] max-[680px]:h-full max-[680px]:max-h-[430px] max-[680px]:w-[min(60vw,236px)] max-[680px]:rounded-[15px] max-[380px]:w-[min(63vw,220px)]">
            <div className="absolute inset-0 -z-4 bg-[linear-gradient(180deg,#d79b66_0%,#edbc85_30%,#788b86_63%,#303d3b_100%)]" />
            <div className="absolute top-[15%] right-[17%] -z-3 aspect-square w-1/4 rounded-full bg-[#f4d79b] blur-[.3px] shadow-[0_0_46px_18px_rgba(244,215,155,.2)]" />
            <div className="absolute -right-[4%] bottom-[22%] -left-[4%] -z-2 flex h-[31%] items-end justify-around gap-[3px] opacity-[.86]">{CITY.map((c, i) => <i key={i} className={cn("[clip-path:polygon(9%_0,91%_0,100%_100%,0_100%)]", c)} />)}</div>
            <div className="absolute bottom-[8%] left-1/2 -z-1 h-[43%] w-[30%] -translate-x-1/2">
              <i className="absolute top-0 left-[37%] aspect-square w-[27%] rounded-full bg-[#402b25] shadow-[0_0_0_2px_rgba(239,199,151,.22)]" />
              <b className="absolute top-[18%] left-[15%] h-[82%] w-[72%] rounded-[42%_42%_8%_8%] bg-[linear-gradient(90deg,#d8d0bc,#f1e7d1_50%,#a69b88)] [clip-path:polygon(24%_0,76%_0,100%_100%,0_100%)]" />
              <span className="absolute top-[24%] left-[47%] h-[72%] w-[7%] -rotate-[7deg] bg-[rgba(115,82,55,.28)]" />
            </div>
            <div className="absolute right-3 bottom-[15px] left-3 text-center [font:600_15px_var(--font-display),Georgia,serif] tracking-[.015em] text-[#fff7e9] [text-shadow:0_2px_10px_rgba(0,0,0,.55)]">golden hour <span className="[font:11px_var(--font-body),sans-serif] text-[#f1d48f]">✦</span></div>
            <button aria-label="Play preview" onClick={() => setPlaying(!playing)} className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-white/36 bg-[rgba(22,22,18,.44)] pl-[3px] text-white backdrop-blur-[10px] transition-[background,transform,scale] duration-200 hover:scale-[1.06] hover:bg-[color:color-mix(in_srgb,var(--accent)_68%,rgba(15,15,13,.4))]"><Glyph name={playing ? "Freeze" : "play"} size={20} /></button>
            <div className={cn("absolute top-2.5 right-2.5 rounded-full border border-white/20 bg-black/28 px-[7px] py-1 text-white/90 backdrop-blur-[5px]", MONO["9b"])}>{shotNo} / 08</div>
          </div>
        </div>
        <div className={cn("flex min-h-[42px] items-center gap-2 text-muted max-[680px]:min-h-10 max-[680px]:gap-1.5", MONO["11"])}>
          <span className="font-bold text-foreground">00:04.8</span><span className="text-[color:color-mix(in_srgb,var(--muted)_50%,transparent)]">/</span><span className="text-muted">00:29.6</span>
          <button className="ml-2.5 cursor-pointer border-0 bg-transparent p-1 text-[12px] text-muted max-[680px]:ml-1">|◂</button>
          <button onClick={() => setPlaying(!playing)} className={cn(GOLD, "grid size-[30px] cursor-pointer place-items-center rounded-full border-0 shadow-[0_6px_16px_-10px_var(--brand-glow)]")}><Glyph name={playing ? "Freeze" : "play"} size={16} /></button>
          <button className="ml-2.5 cursor-pointer border-0 bg-transparent p-1 text-[12px] text-muted max-[680px]:ml-1">▸|</button>
          <span className="flex-1" />
          <span className="inline-flex items-center gap-[5px] [font:700_8px_var(--font-body),sans-serif] tracking-[.1em] text-muted [&_svg]:text-accent"><Glyph name="Music" size={14} /> SOUND ON</span>
        </div>
        <div className="h-[3px] overflow-hidden rounded-[10px] bg-surface-2"><i className="block h-full rounded-[inherit] bg-gold shadow-[0_0_12px_var(--brand-glow)]" style={{ width: "19%" }} /></div>
      </section>

      <aside className={cn(PANEL, "flex min-w-0 flex-col rounded-[19px] p-4 max-[900px]:order-4 max-[900px]:p-[13px] max-[680px]:rounded-2xl")}>
        <div className="flex items-center justify-between gap-2">
          <div><span className={EYEBROW}>CLIP CONTROLS</span><h2 className="mt-[5px] mb-0 [font:600_20px/1.1_var(--font-display),var(--font-body),sans-serif] tracking-[-.035em] max-[680px]:text-[18px]">Shot {shotNo}</h2></div>
          <span className={cn("rounded-full border border-[color:color-mix(in_srgb,var(--accent)_26%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface))] px-[9px] py-1.5 text-accent-hover", MONO["10b"])}>10.7 s</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 max-[900px]:gap-[5px] max-[680px]:gap-1.5 max-[380px]:grid-cols-3">{tools.map((name) => <button key={name} onClick={() => { setTool(name); setOpen(name); }}
          className={cn(`flex min-h-[58px] min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[11px] border border-transparent bg-[color:color-mix(in_srgb,var(--surface-2)_55%,transparent)] px-[3px] py-1.5 text-center [font:500_9px/1.1_var(--font-body),sans-serif] text-muted transition-[color,border-color,background,transform] ${EASE} hover:-translate-y-px hover:border-(--ed-line) hover:bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--surface))] hover:text-foreground max-[900px]:min-h-[54px] max-[900px]:text-[8px] max-[680px]:min-h-[58px] max-[680px]:text-[9px] [&_svg]:text-[color:color-mix(in_srgb,var(--accent)_76%,var(--muted))]`,
            tool === name && "border-[color:color-mix(in_srgb,var(--accent)_34%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_13%,var(--surface))] text-accent-hover shadow-[inset_0_1px_0_rgba(255,255,255,.035)] [&_svg]:text-accent-hover",
            name === "Delete" && "text-[color:color-mix(in_srgb,var(--danger)_82%,var(--muted))] [&_svg]:text-inherit")}><Glyph name={name} /><span>{name}</span></button>)}</div>
        <div className="mt-auto flex items-center gap-2 pt-2.5 text-[10px] text-muted max-[680px]:pt-3"><i className="inline-block size-1.5 flex-none rounded-full bg-accent shadow-[0_0_9px_var(--brand-glow)]" /> {tool} selected for Shot {shotNo}</div>
      </aside>
    </div>

    <section className={cn(PANEL, "min-w-0 overflow-hidden rounded-[19px] max-[900px]:order-2 max-[680px]:rounded-2xl")}>
      <header className="flex min-h-[60px] items-center justify-between gap-2.5 border-b border-(--ed-line) px-3.5 py-[11px] max-[680px]:min-h-[54px] max-[680px]:px-2.5 max-[680px]:py-[9px]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn(TILE_ICON, "size-[34px] rounded-[11px] border border-[color:color-mix(in_srgb,var(--accent)_24%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_8%,var(--surface))] max-[680px]:size-[30px]")}><Glyph name="Shots" /></span>
          <span className="grid gap-0.5"><b className="[font:600_14px_var(--font-display),var(--font-body),sans-serif]">Timeline</b><small className="text-[10px] text-muted">8 clips · 5 layers</small></span>
        </div>
        <div className="flex flex-none items-center gap-1.5 max-[680px]:gap-1">
          <span className={cn("mr-2 text-foreground max-[680px]:hidden", MONO["10b"])}>00:04.8 / 00:29.6</span>
          <button className={cn(FRAMED, "size-7 rounded-lg text-[16px]")} onClick={() => setZoom(Math.max(50, zoom - 10))}>−</button>
          <span className={cn("min-w-8 text-center text-muted", MONO["9b"])}>{zoom}%</span>
          <button className={cn(FRAMED, "size-7 rounded-lg text-[16px]")} onClick={() => setZoom(Math.min(150, zoom + 10))}>+</button>
          <button className={cn(FRAMED, "h-7 rounded-lg px-2 [font:600_9px_var(--font-body),sans-serif]")} onClick={() => setZoom(100)}>Fit</button>
        </div>
      </header>
      <div className="overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-color:color-mix(in_srgb,var(--accent)_38%,var(--muted))_transparent] [scrollbar-width:thin]">
        <div className="relative min-w-[850px] px-3 pt-2.5 pb-2 max-[900px]:min-w-[790px] max-[680px]:min-w-[760px] max-[680px]:px-[9px] max-[680px]:pt-2 max-[680px]:pb-1.5 max-[380px]:min-w-[700px]">
          <div className={cn(rowGrid, "h-7")}>
            <div className="flex items-center pl-2 text-[8px] font-extrabold tracking-[.13em] text-muted">TRACKS</div>
            <div className={cn("relative flex items-start justify-between border-b border-(--ed-line) text-muted", MONO["9"])}>
              {["00:00", "00:05", "00:10", "00:15", "00:20", "00:25", "00:30"].map((x) => <span key={x} className="relative pb-[7px] after:absolute after:-bottom-px after:left-0 after:h-[5px] after:w-px after:bg-[color:color-mix(in_srgb,var(--muted)_50%,transparent)] after:content-['']">{x}</span>)}
              <i className="absolute top-0 z-4 h-[31px] w-px bg-accent shadow-[0_0_8px_var(--brand-glow)]" style={{ left: "19%" }} />
            </div>
          </div>
          {["Effects", "Video", "Text", "Voice", "Music"].map((name) => <div key={name} className={cn(rowGrid, "min-h-11 items-stretch max-[680px]:min-h-[42px]")}>
            <div className={trackLabel}><Glyph name={name === "Video" ? "Shots" : name === "Music" ? "Music" : name === "Text" ? "Text" : name === "Voice" ? "Voice" : "Effect"} size={14} /><span className="truncate">{name}</span>
              <button className="ml-auto grid size-5 flex-none cursor-pointer place-items-center rounded-[7px] border border-[color:color-mix(in_srgb,var(--accent)_20%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--surface))] text-[14px] text-accent max-[680px]:size-[18px]">+</button></div>
            <div className={cn("relative flex min-w-0 items-center gap-[3px] overflow-hidden border-b border-[color:color-mix(in_srgb,var(--border)_65%,transparent)]", name !== "Video" && TRACK_BED)}>
              {name === "Video" ? ["00:00", "00:03", "00:06", "00:09", "00:12", "00:16", "00:20", "00:24"].map((time, j) => <button key={time} onClick={() => setShot(j)} style={{ flex: [1.05, 1.1, .9, 1.2, 1.05, 1.15, .9, 1.2][j] }}
                className={cn(`relative h-[38px] min-w-[34px] basis-0 cursor-pointer overflow-hidden rounded-[7px] border border-white/14 p-0 transition-[box-shadow,transform] ${EASE}`,
                  "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-[55%] before:bg-[linear-gradient(145deg,transparent_30%,rgba(24,33,31,.78)_31%)] before:content-['']",
                  "after:pointer-events-none after:absolute after:-bottom-2 after:left-[37%] after:h-[70%] after:w-1/4 after:rounded-[50%_50%_0_0] after:bg-[rgba(242,232,211,.86)] after:content-['']",
                  SCENES[j % 4], shot === j && "z-2 shadow-[0_0_0_2px_var(--accent),0_0_14px_var(--brand-glow)]")}>
                <span className={cn("absolute top-[3px] left-[5px] z-2 text-white/90 [text-shadow:0_1px_4px_rgba(0,0,0,.65)]", MONO["7b"])}>{time}</span>
                <span className="absolute right-1 bottom-[3px] z-2 text-white/86"><Glyph name="play" size={10} /></span>
              </button>)
              : name === "Effects" ? [["2%", "15%", "Slow drift"], ["22%", "18%", "Zoom burst"], ["48%", "14%", "Film glow"]].map(([left, width, label]) => <span key={label} style={{ left, width }}
                className="absolute z-1 flex h-6 items-center truncate rounded-[7px] border border-[color:color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[linear-gradient(110deg,#d8bd7b,#aa8b4e)] px-2 text-[9px] font-bold text-on-accent shadow-[0_4px_12px_-8px_var(--brand-glow)]">✦ {label}</span>)
              : name === "Text" ? [["4%", "24%", "golden hour memories"], ["55%", "19%", "little moments ✦"]].map(([left, width, label]) => <span key={label} style={{ left, width }}
                className="absolute z-1 min-w-0 truncate rounded-md border border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_75%,#514126)] px-2 py-[5px] text-[8px] font-[650] text-on-accent">{label}</span>)
              : name === "Voice" ? <div className="absolute inset-y-2 right-[48%] left-[5%] z-1 overflow-hidden rounded-md border border-[color:color-mix(in_srgb,#6a9f82_35%,transparent)] bg-[color:color-mix(in_srgb,#507a64_22%,var(--surface))]"><Waveform compact bar="bg-[#89b798]" /></div>
              : <div className="absolute inset-x-0 inset-y-[7px] z-1 overflow-hidden rounded-[7px] border border-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] bg-[color:color-mix(in_srgb,var(--accent)_9%,var(--surface-2))]">
                <Waveform className="top-3 h-[calc(100%-12px)] opacity-[.68]" />
                <span className="absolute top-0.5 left-[7px] z-2 max-w-[70%] truncate text-[8px] font-[650] text-foreground">♫ Golden Hour — JVKE</span>
                {["left-[18%]", "left-[47%]", "left-[76%]"].map((l) => <i key={l} className={cn("absolute inset-y-0 z-2 w-px bg-[rgba(255,242,197,.7)]", l)} />)}
              </div>}
            </div>
          </div>)}
          <div className="pointer-events-none absolute top-2 bottom-[7px] z-5 w-px bg-accent shadow-[0_0_8px_var(--brand-glow)]" style={{ left: "calc(126px + (100% - 126px) * .19)" }}><i className="absolute -top-0.5 -left-1 size-[9px] rounded-full border-2 border-surface bg-accent" /></div>
        </div>
      </div>
      <footer className="flex min-h-[34px] items-center justify-between gap-2 border-t border-(--ed-line) px-3.5 py-[7px] text-[9px] text-muted max-[680px]:px-2.5 max-[680px]:text-[8px]">
        <span className="inline-flex items-center gap-[7px] text-[color:color-mix(in_srgb,#72bd91_74%,var(--foreground))]"><i className={GREEN_DOT} /> All changes saved</span>
        <span className="inline-flex items-center gap-[7px] max-[680px]:hidden">Drag clips to rearrange · Select a shot to edit</span>
      </footer>
    </section>

    <nav aria-label="Editor tools" className={cn(PANEL, "grid min-w-0 grid-cols-[repeat(12,minmax(62px,1fr))] gap-1 overflow-x-auto rounded-[17px] p-2 [scrollbar-color:color-mix(in_srgb,var(--accent)_32%,var(--muted))_transparent] [scrollbar-width:thin] max-[900px]:order-3 max-[900px]:grid-cols-[repeat(12,66px)] max-[680px]:sticky max-[680px]:bottom-[72px] max-[680px]:z-5 max-[680px]:grid-cols-[repeat(12,64px)] max-[680px]:gap-[3px] max-[680px]:rounded-[14px] max-[680px]:bg-[color:color-mix(in_srgb,var(--surface)_90%,transparent)] max-[680px]:bg-[image:none] max-[680px]:p-1.5 max-[680px]:backdrop-blur-[16px]")}>
      {categories.map((name) => <button key={name} onClick={() => { setCategory(name); setOpen(name); }}
        className={cn(`relative flex min-h-[60px] min-w-[62px] cursor-pointer flex-col items-center justify-center gap-[5px] rounded-[11px] border border-transparent bg-transparent [font:550_9px_var(--font-body),sans-serif] whitespace-nowrap text-muted transition-[color,background,border-color,transform] ${EASE} hover:-translate-y-px hover:border-(--ed-line) hover:bg-[color:color-mix(in_srgb,var(--accent)_7%,var(--surface))] hover:text-foreground max-[680px]:min-h-14 max-[680px]:min-w-16 max-[680px]:text-[8px] [&>svg]:text-[color:color-mix(in_srgb,var(--accent)_76%,var(--muted))]`,
          category === name && "border-[color:color-mix(in_srgb,var(--accent)_25%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--surface))] text-accent-hover shadow-[inset_0_-2px_0_var(--accent)] [&>svg]:text-accent-hover")}>
        <Glyph name={name} /><span>{name}</span>
        {pro.includes(name) && <i className={cn(GOLD, "absolute top-0.5 right-0.5 rounded px-1 py-0.5 [font:800_6px_var(--font-body),sans-serif] tracking-[.04em]")}>PRO</i>}
      </button>)}
    </nav>

    {open && typeof document !== "undefined" && createPortal(
      <div onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(null); }}
        className={cn(ED_LINE, "fixed inset-0 z-[9999] isolate grid animate-shade-in place-items-center bg-[rgba(8,8,7,.62)] p-6 backdrop-blur-[10px] motion-reduce:animate-none max-[680px]:items-end max-[680px]:bg-[rgba(5,5,4,.6)] max-[680px]:p-0")}>
        <section role="dialog" aria-modal="true" aria-labelledby="tool-sheet-title"
          className="relative z-1 flex max-h-[min(80vh,720px)] w-[min(100%,660px)] animate-sheet-up flex-col overflow-hidden rounded-3xl border border-[color:color-mix(in_srgb,var(--accent,#c8a96b)_30%,var(--border,#34332c))] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--surface,#191917)_96%,var(--accent,#c8a96b)),var(--surface,#191917))] p-5 text-[color:var(--foreground,#f4f0e7)] shadow-[0_36px_100px_-35px_rgba(0,0,0,.82),0_1px_0_rgba(255,255,255,.08)_inset] motion-reduce:animate-none max-[680px]:max-h-[min(78svh,760px)] max-[680px]:w-full max-[680px]:rounded-[23px_23px_0_0] max-[680px]:border-x-0 max-[680px]:border-b-0 max-[680px]:px-4 max-[680px]:pt-2.5 max-[680px]:pb-[calc(14px+env(safe-area-inset-bottom))]">
          <div className="hidden max-[680px]:mt-px max-[680px]:mb-3 max-[680px]:block max-[680px]:h-1 max-[680px]:w-[38px] max-[680px]:self-center max-[680px]:rounded-full max-[680px]:bg-[color:color-mix(in_srgb,var(--muted)_42%,transparent)]" />
          <header className="flex items-center justify-between gap-4 max-[680px]:min-h-[42px]">
            <div className="flex min-w-0 items-center gap-3">
              <span className={cn(TILE_ICON, "size-[42px] rounded-[14px] border border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface))]")}><Glyph name={open} /></span>
              <span className="grid gap-[3px]"><small className="text-[9px] font-extrabold tracking-[.14em] text-muted">{categories.includes(open) ? "EDITOR TOOL" : `SHOT ${shotNo}`}</small><h2 id="tool-sheet-title" className="m-0 [font:600_21px/1.1_var(--font-display),var(--font-body),sans-serif] tracking-[-.025em] max-[680px]:text-[19px]">{open}</h2></span>
            </div>
            <button type="button" aria-label="Close options" onClick={() => setOpen(null)} className={`grid size-[34px] flex-none cursor-pointer place-items-center rounded-[11px] border border-(--ed-line) bg-surface-2 [font:300_25px/1_var(--font-body),sans-serif] text-muted transition-[color,border-color,transform] ${EASE} hover:rotate-[5deg] hover:border-accent hover:text-accent-hover`}>×</button>
          </header>
          <p className="mt-3 mb-[18px] text-[12px] leading-normal text-muted max-[680px]:mt-[9px] max-[680px]:mb-3.5 max-[680px]:text-[11px]">Choose an option for your Reel. Your selection is ready to preview.</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5 overflow-y-auto px-0.5 pt-0.5 pb-2 [scrollbar-color:color-mix(in_srgb,var(--accent)_36%,var(--muted))_transparent] [scrollbar-width:thin] max-[680px]:grid-cols-3 max-[680px]:gap-2 max-[380px]:grid-cols-2">
            {choices.map((choice, index) => { const on = (selected[open] ?? choices[0]) === choice, fx = TRANSITION_FX[index] ?? {}; return <button type="button" key={choice} aria-pressed={on} onClick={() => setSelected((current) => ({ ...current, [open]: choice }))}
              className={cn(`relative flex min-h-[100px] min-w-0 cursor-pointer flex-col items-stretch justify-between gap-2.5 rounded-[14px] border border-(--ed-line) bg-[color:color-mix(in_srgb,var(--surface-2)_70%,var(--surface))] p-2.5 text-left text-muted transition-[transform,border-color,background,box-shadow] ${EASE} hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--accent)_42%,var(--border))] hover:text-foreground max-[680px]:min-h-[86px] max-[680px]:rounded-xl max-[680px]:p-2`,
                on && "border-[color:color-mix(in_srgb,var(--accent)_65%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_11%,var(--surface))] text-foreground shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_22%,transparent)_inset,0_10px_22px_-18px_var(--brand-glow)]")}>
              <span className="grid min-h-[52px] place-items-center overflow-hidden rounded-[9px] border border-[color:color-mix(in_srgb,var(--accent)_12%,var(--border))] bg-[color:color-mix(in_srgb,var(--background)_65%,var(--surface))] text-accent max-[680px]:min-h-[43px]">
                {open === "Transition" ? <span className="flex w-[78%] items-center justify-between gap-1">
                  <i className={cn("h-[29px] w-[25px] rounded border border-white/20 bg-[linear-gradient(150deg,#dfb487,#3b655b_56%,#202b29)]", fx.first)} />
                  <b className={cn("[font:700_14px_var(--font-body),sans-serif] text-accent", fx.arrow)}>→</b>
                  <i className={cn("h-[29px] w-[25px] rounded border border-white/20 bg-[linear-gradient(150deg,#d7ba83,#8e684e_53%,#292522)]", fx.last)} />
                </span> : open === "Effect" || open === "Filters" ? <span className={cn("relative h-[34px] w-[68%] overflow-hidden rounded-[5px] border border-white/18 bg-[linear-gradient(155deg,#dfa978,#4f7770_54%,#242a27)]", EFFECT_FX[index % 4])}>
                  <i className="absolute -right-1.5 -bottom-3 -left-1.5 h-[22px] bg-[rgba(20,25,22,.62)] [clip-path:polygon(0_30%,30%_0,55%_38%,78%_8%,100%_42%,100%_100%,0_100%)]" />
                </span> : <Glyph name={open} />}
              </span>
              <span className="truncate pr-3.5 text-[10px] font-[650] max-[680px]:text-[9px]">{choice}</span>
              {on && <span className="absolute right-2 bottom-2 text-[12px] font-extrabold text-accent-hover">✓</span>}
            </button>; })}
          </div>
          <footer className="mt-3.5 flex items-center justify-between gap-3 border-t border-(--ed-line) pt-3.5 max-[680px]:mt-2.5 max-[680px]:pt-2.5">
            <span className="inline-flex items-center gap-2 text-[10px] text-muted">Preview selection · Shot {shotNo}</span>
            <button type="button" onClick={() => setOpen(null)} className={cn(GOLD, `inline-flex min-h-[38px] cursor-pointer items-center justify-center gap-2 rounded-[11px] border-0 px-3.5 [font:650_11px_var(--font-body),sans-serif] shadow-[0_9px_18px_-13px_var(--brand-glow)] transition-[transform,filter] ${EASE} hover:-translate-y-px hover:brightness-[1.08]`)}>Done <Glyph name="Transition" size={15} /></button>
          </footer>
        </section>
      </div>,
      document.body,
    )}
  </main>;
}
