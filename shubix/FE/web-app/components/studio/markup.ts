/** The Fast Studio page body (ids are what components/studio/engine.ts wires up). Everything runs in the browser.
 *
 * One editor for everyone (the .brs root carries v-one, set by components/studio/views.ts): the song and clips fold
 * into one line each; the preview, the timeline and one tool bar with every tool (shot, music, text, captions, look,
 * motion, background, overlay, voice, style), one panel open at a time. A plan's tools carry its tag (views.ts PLAN_TOOLS).
 * ?view=all opens every panel at once (checks and support). */
import { PLAN_TOOLS } from "./views";
import { GLYPH_PATHS } from "@shubix/ui-web";
import { DOCK_CATEGORIES_DEF, PANEL_NOTE, SHOT_TOOLS_DEF } from "@shubix/core/lib/editor-tools";
export { DOCK_CATEGORIES_DEF, SHOT_TOOLS_DEF };
import { Button, Chip, Segmented, Tile } from "./ui";

const I = (d: string, extra = "") =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const IC = {
  menu: I('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  shot: I('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'),
  music: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  text: I('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
  captions: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h10"/>'),
  look: I('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>'),
  motion: I('<path d="M12 3l9 9-9 9-9-9z"/>'),
  bg: I('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M6 19c1.5-3 4-4 6-4s4.5 1 6 4"/>'),
  voice: I('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>'),
  style: I('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>'),
  play: I('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>'),
  mix: I('<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  save: I('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  chev: I('<path d="M9 6l6 6-6 6"/>'),
  image: I('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'),
  copy: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>'),
  prev: I('<path d="M6 5v14M19 5v14L8 12z" fill="currentColor"/>'),
  next: I('<path d="M18 5v14M5 5v14l11-7z" fill="currentColor"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  layers: I('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: I('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  back: I('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrow: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  pen: I('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  spark: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" fill="currentColor" stroke="none"/>'),
  upload: I('<path d="M12 16V4M7 9l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>'),
  scan: I('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/>'),
  lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  crown: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/></svg>',
};
// the Create flow's AI checklist (step 3 on computers, the Analysing screen on phones); data-t: the tasks it follows
// the top bar: the format menu (each format's shape) and undo / redo
// the format menu: ratio, its CMS label (texts-studio), the little frame's size
const ASPECTS = [["9:16", "Reels, Shorts, Stories", "w-3 h-[21px]"], ["4:5", "Instagram feed", "w-4 h-5"], ["1:1", "Square post", "size-[18px]"], ["16:9", "YouTube, wide", "w-[22px] h-[13px]"]];
// a card of the flow (Music, Clips, Shubix Edit); on phones the Music and Clips screens have no card around them;
// locked: waits for the step before it
const flowCard = "grid min-w-0 gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--accent)_13%,var(--border))] bg-surface px-5 py-[18px] shadow-[0_18px_44px_-36px_rgba(0,0,0,.7),inset_0_1px_0_rgba(255,255,255,.035)] transition-[border-color,box-shadow] duration-200 hover:border-[color-mix(in_srgb,var(--accent)_34%,var(--border))] hover:shadow-[0_20px_44px_-34px_rgba(0,0,0,.72),inset_0_1px_0_rgba(255,255,255,.04)] [&.locked]:saturate-[.72] max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:px-0 max-lg:pt-1 max-lg:pb-0 max-lg:shadow-none max-lg:hover:shadow-none";
// a step's head: its number, its name (and what it is for)
const stepHead = "flex w-full items-start gap-3 text-left";
const stepNumber = "grid size-7 flex-none place-items-center rounded-[9px] bg-gold text-[13px] font-semibold text-on-accent";
const stepText = "grid min-w-0 flex-1 gap-px";
const stepNote = "text-[12.5px] font-medium text-muted";
const stepTitle = "font-display text-[16px] font-semibold tracking-[-.005em]";
// the flow's main button: on phones fixed at the bottom of the screen
const phoneBottomButton = `${Button.primaryLarge} max-lg:fixed max-lg:inset-x-4 max-lg:bottom-[calc(14px+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:min-h-[52px] max-lg:w-auto max-lg:rounded-[14px] max-lg:text-[16px] max-lg:shadow-[0_14px_30px_-12px_var(--brand-glow)]`;
// a step of the flow's head (data-s: on = this one, ok = done); on phones a dot, the steps joined by a line
const stepItem = "group relative grid min-w-[84px] justify-items-center gap-1.5 text-xs font-semibold text-muted data-[s=on]:text-accent before:absolute before:top-[13px] before:right-[calc(50%+18px)] before:h-0.5 before:w-[calc(100%-36px)] before:bg-border first:before:hidden data-[s=on]:before:bg-accent data-[s=ok]:before:bg-accent max-lg:flex max-lg:min-w-0 max-lg:flex-1 max-lg:items-center max-lg:gap-0 max-lg:first:flex-none max-lg:before:static max-lg:before:mx-1.5 max-lg:before:w-auto max-lg:before:flex-1 max-lg:before:rounded-sm max-lg:last:hidden";
const stepDot = "grid size-7 flex-none place-items-center rounded-full border border-border bg-surface-2 text-xs font-semibold not-italic text-muted group-data-[s=on]:border-transparent group-data-[s=on]:bg-gold group-data-[s=on]:text-on-accent group-data-[s=on]:shadow-[0_0_0_5px_color-mix(in_srgb,var(--accent)_22%,transparent)] group-data-[s=ok]:border-accent group-data-[s=ok]:bg-[color-mix(in_srgb,var(--accent)_25%,var(--surface))] group-data-[s=ok]:text-foreground max-lg:size-2.5 max-lg:border-0 max-lg:bg-muted/55 max-lg:text-[0px] max-lg:group-data-[s=ok]:bg-accent max-lg:group-data-[s=on]:size-[30px] max-lg:group-data-[s=on]:bg-gold max-lg:group-data-[s=on]:text-[13px]";
const undoRedoButton = `${Button.icon} size-11 in-[.fpost]:size-9`;
const AI_STEPS: [string, string, string][] = [
  ["scenes", "Detecting scenes and best moments", "clips"],
  ["beats", "Matching with music beats", "beats"],
  ["faces", "Auto transitions and effects", "ai"],
  ["look", "Colour and quality enhancement", "make"],
];
// each step its own picture (scenes, beats, transitions, colour); a dot says waiting / working / done
const AI_ICONS: Record<string, string> = { scenes: IC.scan, beats: IC.music, faces: IC.motion, look: IC.look };
const aiList = (cls: string) => `<ul class="${cls}">${AI_STEPS.map(([k, t, d]) => `<li data-ai="${k}" data-t="${d}">${AI_ICONS[k] ?? IC.scan}<span>${t}</span><i class="faidot" aria-hidden="true"></i></li>`).join("")}</ul>`;
// a tool: a button in the tool bar and the heading of its panel
// in the editor's order (the tool bar on a phone, the rail on a computer)
export { GLYPH_PATHS }; // the tools' line signs, shared with the phone app (Shared/ui-core/src/glyphs.ts)

export const Glyph = (name: string, size = 18) => {
  const d = GLYPH_PATHS[name] ?? "m12 3 2 6 6 3-6 2-2 7-2-7-6-2 6-3z";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}" /></svg>`;
};



export const shotToolGridHtml = SHOT_TOOLS_DEF.map(([name, act]) =>
  `<button type="button" class="${Tile} min-h-[58px]"${name === "Delete" ? " data-danger" : ""} data-st="${act}" data-stname="${name}">${Glyph(name, 18)}<span>${name}</span></button>`
).join("");

// a plan's tool (views.ts PLAN_TOOLS) carries its plan's tag (views.ts writes the plan's name); on a lower plan it opens /pricing
const dock = DOCK_CATEGORIES_DEF.map(([k, n]) =>
  `<button type="button" class="tool group ${Tile} min-h-[60px] min-w-[62px] whitespace-nowrap" data-tool="${k}" aria-pressed="false">${Glyph(n, 18)}<span>${n}</span>${PLAN_TOOLS.has(k) ? `<em class="protag proTag hidden group-data-[locked=true]:inline-flex"><b>PRO</b></em>` : ""}</button>`
).join("");
// a tool's popup header, as the design's sheets: its sign in a square, "Editor tool" over its name, then what it is for
const panelHead = (k: string) => {
  const cat = DOCK_CATEGORIES_DEF.find((x) => x[0] === k);
  const name = cat ? cat[1] : k.charAt(0).toUpperCase() + k.slice(1);
  return `<header class="ph sheetHeader"><span class="sheetHeading"><span class="sheetIcon">${Glyph(name, 18)}</span><span><small>EDITOR TOOL</small><b>${name}</b></span></span></header>`
    + (PANEL_NOTE[k] ? `<p class="sheetDescription">${PANEL_NOTE[k]}</p>` : "");
};

export const STUDIO_HTML = `
<nav class="fcrumbs" id="fcrumbs" aria-label="Breadcrumb"></nav>
<header id="topbar" class="hidden in-[.made]:flex in-[.fopen]:hidden! in-[.opening]:hidden! top-0 z-30 max-lg:sticky max-lg:top-[65px] max-lg:z-20 w-full max-w-[1240px] min-h-[66px] mx-auto mb-4 items-center justify-between gap-3.5 rounded-[18px] border border-edge shadow-(--shadow) bg-[linear-gradient(145deg,color-mix(in_srgb,var(--surface)_97%,var(--accent)),var(--surface))] lg:pb-2.5 lg:in-[.editing]:px-4 in-[.fpost]:sticky in-[.fpost]:z-40 in-[.fpost]:-mx-4 in-[.fpost]:mb-1 in-[.fpost]:px-3 in-[.fpost]:pb-2 in-[.fpost]:pt-[max(8px,env(safe-area-inset-top))] in-[.fpost]:gap-1.5 in-[.fpost]:in-[.editing]:gap-1 in-[.fpost]:border-b-border in-[.fpost]:bg-none in-[.fpost]:bg-background max-[680px]:relative! max-[680px]:min-h-[58px] max-[680px]:px-2.5! max-[680px]:gap-2! max-[680px]:rounded-[15px]">
  <button type="button" id="tbback" aria-label="Back" class="${Button.iconBordered} size-10 shrink-0 max-[680px]:size-9">${IC.back}</button>
  <div class="flex min-w-0 flex-1 items-center gap-[11px] leading-[1.15] max-[680px]:basis-auto">
    <span class="grid size-10 shrink-0 place-items-center rounded-[13px] border border-[color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] text-accent max-[680px]:size-[34px] max-[680px]:rounded-[11px]">${Glyph("Shots", 20)}</span>
    <span class="flex min-w-0 flex-col items-start gap-[3px] max-[680px]:max-w-full">
      <small class="flex items-center gap-[7px] text-[9px] font-[750] tracking-[.13em] text-muted max-[680px]:max-w-full max-[680px]:overflow-hidden max-[680px]:whitespace-nowrap max-[680px]:text-[7px]">REEL STUDIO <i aria-hidden="true" class="inline-block size-1.5 shrink-0 rounded-full bg-[#72bd91] shadow-[0_0_10px_color-mix(in_srgb,#72bd91_55%,transparent)]"></i> <span id="psaved" class="max-[680px]:truncate">SAVED REEL</span></small>
      <strong id="tbname" class="block max-w-[34ch] truncate text-[15px] font-normal tracking-[-.02em] max-[680px]:max-w-full max-[680px]:text-[13px]">Your Reel</strong>
    </span>
  </div>
  <div id="tbasp" class="relative flex max-[680px]:contents">
    <button type="button" id="tbaspbtn" aria-haspopup="listbox" aria-expanded="false" aria-label="Format" title="Format" class="group inline-flex h-9 items-center gap-1.5 rounded-[11px] border border-border bg-surface-2 pl-3 pr-2.5 tabular-nums hover:border-accent aria-expanded:border-accent max-[680px]:hidden"><span id="tbaspv">9:16</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-muted transition-transform duration-200 group-aria-expanded:rotate-180"><path d="M6 9l6 6 6-6"/></svg></button>
    <div id="tbaspmenu" role="listbox" aria-label="Format" hidden class="absolute left-0 top-[calc(100%+6px)] z-60 grid min-w-[220px] animate-drop gap-0.5 rounded-[14px] border border-border bg-surface p-1.5 shadow-[0_18px_40px_-18px_rgba(20,8,50,.45)] max-lg:-right-[60px] max-lg:left-auto max-lg:min-w-[210px] [&.atprev]:fixed! [&.atprev]:right-auto! [&.atprev]:z-[9995]!">
      ${ASPECTS.map(([a, label, frame]) => `<button type="button" role="option" data-a="${a}" class="group flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-surface-2 aria-selected:bg-accent/10"><span class="grid size-[26px] place-items-center"><span class="rounded-[3px] border-[1.6px] border-current text-muted group-aria-selected:bg-accent/20 group-aria-selected:text-accent ${frame}"></span></span><span class="grid"><b class="text-[13px] font-semibold group-aria-selected:text-accent">${a}</b><small class="text-[11.5px] text-muted">${label}</small></span></button>`).join("")}
    </div>
  </div>
  <div class="flex shrink-0 items-center gap-[7px]">
    <span role="group" aria-label="Undo and redo" class="flex gap-1 in-[.fpost]:gap-0 in-[.fpost]:in-[.editing]:hidden max-[680px]:hidden">
      <button type="button" id="undo" disabled aria-label="Undo" title="Undo (Ctrl+Z)" class="${undoRedoButton}">↶</button>
      <button type="button" id="redo" disabled aria-label="Redo" title="Redo (Ctrl+Shift+Z)" class="${undoRedoButton}">↷</button>
    </span>
    <button type="button" id="tbasfree" aria-pressed="false" title="Preview as Free user" class="hidden in-[.admin.made]:inline-flex max-lg:hidden! items-center gap-1.5 rounded-[10px] border border-border bg-surface px-[15px] py-2.5 text-[12.5px] font-semibold hover:border-muted aria-pressed:border-transparent aria-pressed:bg-gold aria-pressed:text-on-accent">Preview as Free</button>
    <button type="button" id="tbchat" aria-label="Ask Shubix" title="Ask Shubix" class="relative flex h-9 items-center justify-center justify-items-center gap-1.5 rounded-[11px] border border-edge bg-[color-mix(in_srgb,var(--surface-2)_70%,var(--surface))] px-[13px] text-accent lg:h-[38px] lg:rounded-xl lg:px-3.5 in-[.fpost]:in-[.editing]:size-[38px] in-[.fpost]:in-[.editing]:rounded-xl max-[680px]:size-9 max-[680px]:shrink-0 max-[680px]:px-0 max-[680px]:[&>span]:hidden [&.news]:before:absolute [&.news]:before:right-1 [&.news]:before:top-1 [&.news]:before:size-[9px] [&.news]:before:rounded-full [&.news]:before:bg-danger [&.news]:before:content-['']">${IC.spark}<span class="max-lg:hidden">Ask Shubix</span></button>
    <button type="button" id="topexport" disabled class="${Button.primary} in-[.fpost]:h-[38px] max-[680px]:px-2.5 max-[680px]:text-[11px]">Export ${IC.arrow}</button>
  </div>
</header>
<div class="wrap">
  <div class="invisible grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:-mx-4 max-lg:-mt-4 max-lg:grid-cols-[40px_minmax(0,1fr)_auto] max-lg:gap-3 max-lg:bg-background max-lg:px-4 max-lg:pt-[max(12px,env(safe-area-inset-top))] max-lg:pb-3" id="fhead" hidden>
    <button type="button" class="${Button.iconBordered} size-11 max-lg:size-10" id="fback" aria-label="Back">${IC.back}</button>
    <b class="peer hidden truncate font-display text-[17px] font-semibold tracking-[-.01em] max-lg:block max-lg:empty:hidden" id="fptitle"></b>
    <div class="max-lg:hidden"><h1 class="font-display text-[clamp(21px,2vw,24px)] leading-[1.15] font-semibold tracking-[-.015em]" id="ftitle">Music Reel</h1><p class="mt-1 text-[13px] text-muted" id="fsub">Turn your clips into a stunning Reel with music, beats and Shubix edits.</p></div>
    <ol class="flex items-start max-lg:col-span-3 max-lg:row-start-2 max-lg:w-[190px] max-lg:items-center max-lg:justify-self-center max-lg:peer-empty:col-span-1 max-lg:peer-empty:col-start-2 max-lg:peer-empty:row-start-1" id="fsteps" aria-label="Steps">
      <li class="${stepItem}" data-f="1"><i class="${stepDot}">1</i><span class="max-lg:hidden">Music</span></li><li class="${stepItem}" data-f="2"><i class="${stepDot}">2</i><span class="max-lg:hidden">Clips</span></li><li class="${stepItem}" data-f="3"><i class="${stepDot}">3</i><span class="max-lg:hidden">Shubix Edit</span></li><li class="${stepItem}" data-f="4"><i class="${stepDot}">4</i><span class="max-lg:hidden">Preview &amp; Export</span></li>
    </ol>
    <button type="button" class="${Button.ghost} hidden max-lg:col-start-3 max-lg:row-start-1 max-lg:in-[.fopen[data-fstep=intro]]:inline-flex" id="fskip">Skip</button>
  </div>
  <form class="askbar" id="askbar" aria-labelledby="askbarh">
    <button type="button" class="askbarhd" id="asktoggle" aria-expanded="false" aria-controls="askbody">
      <span class="chatorb" aria-hidden="true">${IC.spark}</span>
      <span class="askbart"><b id="askbarh">Ask Shubix <em>AI</em></b><small>Say how you want your Reel: the pace, the moments, zooms, transitions, slow-mo, text… Shubix edits it for you.</small></span>
      <span class="askchev" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
    </button>
    <div class="askbody" id="askbody">
    <div class="chatfield askfield">
      <input id="askin" maxlength="300" autocomplete="off" placeholder="e.g. Fast cuts, zoom on the drop">
      <button type="submit" class="${Button.iconPrimary} size-9" aria-label="Ask Shubix"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
    </div>
    <div class="askchips" id="askchips"><span>Try:</span>
      <button type="button" data-say="Fast cuts on every beat, high energy">Fast & energetic</button>
      <button type="button" data-say="Make it calm and cinematic, slower cuts">Calm & cinematic</button>
      <button type="button" data-say="Zoom in on the drop and add camera moves on the beats">Zoom on the drop</button>
      <button type="button" data-say="Slow motion on the best moment at the end">Slow-mo ending</button>
    </div>
    </div>
  </form>
  <section class="invisible grid content-start justify-items-center gap-3 px-1 pt-2 pb-1 text-center lg:hidden" id="fintro" aria-labelledby="fintroh" hidden>
    <span class="grid size-[76px] place-items-center rounded-[22px] bg-gold shadow-[0_0_0_10px_color-mix(in_srgb,var(--accent)_12%,transparent),0_18px_40px_-16px_var(--brand-glow)] [&>svg]:size-12! [&>svg]:bg-transparent! [&>svg]:p-0! [&>svg]:text-white" id="fintroic">${IC.music}</span>
    <h2 class="mt-1.5 font-display text-[27px] font-semibold tracking-[-.02em]" id="fintroh">Create a Music Reel</h2>
    <p class="max-w-[30ch] text-[14.5px] text-muted" id="fintrop">Turn your clips into a stunning Reel with music, beats and Shubix edits.</p>
    <ul class="mt-3.5 mb-1.5 grid gap-3 justify-self-stretch px-1.5 text-left" id="fintrol"><li class="flex items-center gap-3 text-[15px] font-semibold [&>svg]:size-6 [&>svg]:flex-none [&>svg]:rounded-full [&>svg]:bg-accent [&>svg]:p-1 [&>svg]:stroke-3 [&>svg]:text-white">${IC.check}Pick a song</li><li class="flex items-center gap-3 text-[15px] font-semibold [&>svg]:size-6 [&>svg]:flex-none [&>svg]:rounded-full [&>svg]:bg-accent [&>svg]:p-1 [&>svg]:stroke-3 [&>svg]:text-white">${IC.check}Add your videos or photos</li><li class="flex items-center gap-3 text-[15px] font-semibold [&>svg]:size-6 [&>svg]:flex-none [&>svg]:rounded-full [&>svg]:bg-accent [&>svg]:p-1 [&>svg]:stroke-3 [&>svg]:text-white">${IC.check}Shubix edits on the beat</li><li class="flex items-center gap-3 text-[15px] font-semibold [&>svg]:size-6 [&>svg]:flex-none [&>svg]:rounded-full [&>svg]:bg-accent [&>svg]:p-1 [&>svg]:stroke-3 [&>svg]:text-white">${IC.check}Preview, make changes and export</li></ul>
    <button type="button" class="${phoneBottomButton}" data-fnext="1"><span id="fgot">Let's Start</span> ${IC.arrow}</button>
    <button type="button" class="${Button.ghost} mt-2 w-full" id="fsample" hidden>No clips with you? Try it with our sample clips</button>
  </section>
  <!-- the kind and the template, pressed by the address (/create/music|talking|photo, /create/story, ?tpl=): never
       shown (each kind has its own page now); the engine, steps.ts and auto.ts read and press these buttons -->
  <section class="step starts" id="s0" hidden>
    <div class="${stepHead}"><span class="${stepNumber}">1</span><h2 class="${stepTitle}">What are we making?</h2><span class="ml-auto text-[12.5px] text-muted" id="s0st">Choose one to start</span></div>
    <div class="sbody">
    <div class="makegrid">
      <button type="button" class="kindx storycard" id="storykind">${IC.text}<span><b>Story → Reel</b><small>Write it; Shubix narrates it, shows it scene by scene, adds captions</small></span></button>
      <div class="kinds" id="kind" role="group" aria-label="Kind of Reel">
        <button data-k="music" aria-pressed="false">${IC.music}<span><b>Music Reel</b><small>Cuts land on every beat</small></span></button>
        <button data-k="talk" aria-pressed="false">${IC.voice}<span><b>Talking Reel</b><small>Pauses cut, captions added</small></span></button>
      </div>
      <button type="button" class="kindx" id="photokind" aria-pressed="false">${IC.image}<span><b>Photos to Reel</b><small>Your photos, moving to the music</small></span></button>
      <button type="button" class="kindx copycard" id="copycard" aria-pressed="false">${IC.copy}<span><b>Copy a Reel</b><small>Match a Reel you like: its cuts and look</small></span></button>
    </div>
  <div class="tplrow">
    <span class="label">Or start from a template</span>
    <div class="tpl" id="tpl" role="group" aria-label="Templates"><!-- filled by the studio: the templates from Admin -->
    </div>
    <span class="fname" id="tplhelp"></span>
  </div>
    </div>
  </section>



  <div class="fgrid">
  <div class="fmain">
  <!-- Copy a Reel (/create/copy): the Reel being copied, at the top; its song is the Reel's song unless the creator
       chooses another (flow.ts) -->
  <section class="fref" id="fref" aria-label="Reel to copy">
    <span class="fsongic">${IC.copy}</span>
    <span class="fsongt"><b>Reel to copy</b><small id="frefst">Pick a Reel you like: its song, cuts, transitions and look go on your clips</small>
      <button type="button" class="justify-self-start text-[13px] font-semibold text-accent underline" id="frefother">Different song? Choose it here</button></span>
    <span class="frefbtns"><button type="button" class="${Button.primary}" id="frefpick">Pick the Reel</button><button type="button" class="${Button.ghost}" id="frefsong" hidden>Use its song</button></span>
  </section>
  <section class="${flowCard}" id="s1">
    <button type="button" class="sh ${stepHead} max-lg:hidden" aria-expanded="true"><span class="${stepNumber}">1</span><span class="${stepText}"><h2 class="${stepTitle}">Choose Music</h2><small class="fsh ${stepNote}">Pick a song or sound for your Reel</small></span><span class="hidden" id="s1st">Choose a song to start</span></button>
    <div class="grid min-w-0 gap-3.5">
    <div class="fchoose">
    <div class="row fpickrow">
      <button class="${Button.primary}" id="mpick">${IC.music}<span>Choose song</span></button>
      <input id="mfile" type="file" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.mov,.mp4" hidden>
      <span class="fname" id="mname">MP3, M4A, WAV or any video's sound (iPhone: from Files or Photos)</span>
      <button class="${Button.ghost}" id="skipmusic" type="button" hidden>Continue without music</button>
    </div>
    <div class="recent" id="recent" hidden><span class="label">Recent songs</span><div class="rlist" id="rlist"></div></div>
    <button type="button" class="${phoneBottomButton} fnext hidden max-lg:in-[.fopen]:inline-flex" data-fnext="1" id="fchnext" disabled><span id="fchnt">Next</span> ${IC.arrow}</button>
    </div>
    <div class="fadjust">
    <div class="fsong" id="fsong"><span class="fsongic">${IC.music}</span><span class="fsongt"><b id="fsongn"></b><small id="fsongd"></small></span></div>
    <div class="fwavebox"><canvas class="wave" id="mwave"></canvas></div>
    <div class="row lenrow" id="lenrow" hidden>
      <span class="label">Reel length</span>
      <div class="${Segmented.normal}" id="slen" role="group" aria-label="How much of the song">
        <button data-l="0" aria-pressed="true">Full</button><button data-l="15" aria-pressed="false">15 s</button><button data-l="30" aria-pressed="false">30 s</button><button data-l="60" aria-pressed="false">1 min</button><button data-l="c" aria-pressed="false">Custom</button>
      </div>
      <label class="lenc" hidden id="slencw"><input id="slenc" type="number" inputmode="numeric" min="5" max="180" step="1" value="45"> s</label>
      <button class="${Button.secondary}" id="sauto" hidden title="Pick the strongest part of the song again">${IC.style}Best part</button>
      <span class="sinfo" id="sinfo"></span>
    </div>
    <p class="hint" id="lenhint" hidden>Drag on the waveform to choose the part yourself.</p>
    <div class="stats">
      <span>Length <b id="mdur">—</b></span>
      <span><b id="mbpm">—</b> BPM</span>
      <span>Shots <b id="mclips">—</b></span>
      <span>Drops <b id="mdrop">—</b></span>
      <span>Breaks <b id="mbreak">—</b></span>
    </div>
    <div class="fsugg" id="fsugg">${IC.spark}<span><b>Suggested Part</b><small>We found the best part of the song, with strong beats. Drag on the waveform to choose another.</small></span></div>
    <div class="legend">
      <span><i style="background:var(--drop)"></i>Drop: best shot</span>
      <span><i style="background:var(--hit)"></i>Hit: strong accent</span>
      <span><i style="background:var(--cut)"></i>Cut: plain cut</span>
      <span><i style="background:var(--break)"></i>Break: slow motion</span>
    </div>
    <button type="button" class="${phoneBottomButton} fnext hidden max-lg:in-[.fopen]:inline-flex" data-fnext="1" id="fadjnext" disabled><span id="fadjnt">Next</span> ${IC.arrow}</button>
    </div>
    </div>
  </section>

  <section class="${flowCard} locked" id="s2">
    <button type="button" class="sh ${stepHead} max-lg:hidden" aria-expanded="true"><span class="${stepNumber}">2</span><span class="${stepText}"><h2 class="${stepTitle}">Clips</h2><small class="fsh ${stepNote}">Add multiple videos or photos. The more clips, the better!</small></span><span class="hidden" id="s2st">Several clips or one long video</span></button>
    <div class="grid min-w-0 gap-3.5">
    <div class="ftabs" id="ftabs" role="group" aria-label="Videos or photos"><button type="button" data-ft="videos" aria-pressed="true">Videos</button><button type="button" data-ft="photos" aria-pressed="false">Photos</button></div>
    <div class="drop" id="dropzone" role="button" tabindex="0">${IC.upload}<b class="vonly fdesk">Drag &amp; drop videos here</b><b class="ponly fdesk">Drag &amp; drop photos here</b><b class="vonly fmob">Tap to Add Videos</b><b class="ponly fmob">Tap to Add Photos</b><span class="vonly fdesk">or tap to choose · you can add more at any time</span><span class="ponly fdesk">or tap to choose · each photo becomes a short moving shot</span><span class="fmob">or choose from gallery</span><small>Supports MP4, MOV, 3GP, JPG, PNG</small></div>
    <input id="vfile" type="file" accept="video/*,.mov,.mp4,.m4v" multiple hidden>
    <div class="row">
      <button class="${Button.primary}" id="addv"><span class="vonly">+ Add videos</span><span class="ponly">+ Add photos</span></button>
      <button class="${Button.secondary}" id="clearv" hidden>Remove all</button>
      <span class="fname" id="qinfo"></span>
    </div>
    <!-- how the clips go into the Reel: the best moments of all of them, or one after another as they were added (engine.ts) -->
    <div class="row seqrow" id="seqrow"><span class="label">Clip order</span>
      <div class="${Segmented.normal}" id="seq" role="group" aria-label="Clip order"><button type="button" data-q="mix" aria-pressed="true">Mix all clips</button><button type="button" data-q="order" aria-pressed="false">In my order</button></div>
      <span class="fname" id="seqhelp">Shubix picks the best moments from all your clips</span>
      <button type="button" class="${Button.small}" id="crev" hidden title="The clips' numbers are their order: turn it round">⇅ Reverse order</button></div>
    <div class="row items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2" id="corder" hidden><span class="flex-1 text-[13px] font-semibold">Tap your clips in the order they should play: 1, 2, 3…</span><button type="button" class="${Button.small}" id="corderskip">Keep as is</button></div>
    <span class="flabel fcliplabel">Selected Clips</span>
    <div class="fclipgrid"><div class="clips" id="clips"></div><button type="button" class="hidden max-lg:in-[.fopen_#s2:has(.clip)]:grid aspect-square place-items-center rounded-[14px] border-[1.5px] border-dashed border-border bg-surface-2 [&>svg]:size-7 in-[.noir_#mslot]:hidden!" id="fadd" aria-label="Add more clips">${IC.plus}</button></div>
    <div class="row talkrow" id="talkrow" hidden>
      <span class="label">Pauses</span>
      <div class="${Segmented.normal}" id="tpace" role="group" aria-label="How much of the pauses to cut">
        <button data-p="tight" aria-pressed="false">Tight</button><button data-p="natural" aria-pressed="true">Natural</button><button data-p="relaxed" aria-pressed="false">Relaxed</button><button data-p="off" aria-pressed="false">Keep all</button>
      </div>
      <span class="label">Music under voice</span>
      <div class="${Segmented.normal}" id="tmusic" role="group" aria-label="Music volume under the voice">
        <button data-v="0" aria-pressed="false">Off</button><button data-v="0.05" aria-pressed="false">Soft</button><button data-v="0.09" aria-pressed="true">Medium</button><button data-v="0.16" aria-pressed="false">Loud</button>
      </div>
      <label class="tog"><input type="checkbox" id="dn1" checked> Clean up voice noise</label>
      <span class="fname" id="tinfo"></span>
    </div>
    <div class="row fmtrow">
      <span class="label">Format</span>
      <div class="${Segmented.small}" id="aspect">
        <button data-a="9:16" aria-pressed="true">9:16 Reel</button>
        <button data-a="4:5" aria-pressed="false">4:5</button>
        <button data-a="1:1" aria-pressed="false">1:1</button>
        <button data-a="16:9" aria-pressed="false">16:9</button>
      </div>
    </div>
    <span class="fslot" id="fsndslot"></span>
    <button type="button" class="${phoneBottomButton} fnext hidden max-lg:in-[.fopen]:inline-flex" data-fnext="1" id="fclipsnext" disabled><span id="fclipsnt">Next</span> ${IC.arrow}</button>
    </div>
  </section>

  <section class="${flowCard} fai max-lg:hidden" id="fai">
    <div class="${stepHead}"><span class="${stepNumber}">3</span><span class="${stepText}"><h2 class="${stepTitle}">Shubix Edit</h2><small class="fsh ${stepNote}">We'll analyse your clips, match them with the beats and create a stunning Reel.</small></span></div>
    <div class="faibody">
      ${aiList("faiList")}
      <div class="fready" id="fready"><span class="freadyic" aria-hidden="true">${IC.spark}</span><span class="freadytx"><b id="freadyt">Ready to create your Reel!</b><small id="freadys">Add a song and your clips, then press Generate.</small></span></div>
    </div>
  </section>
  </div>

  <aside class="fprev" id="fprev" aria-label="Reel preview">
    <div class="fprevh"><b>Reel Preview</b><span class="fslot" id="faspslot"></span></div>
    <div class="fprevbox" id="fprevbox"><span class="fplay">${IC.play}</span><small id="fprevnote">Your Reel appears here</small></div>
    <button type="button" class="${Button.primaryLarge} fgen" id="fgen" disabled>${IC.spark}<span id="fgent">Generate Reel</span>${IC.arrow}</button>
    <ul class="fperks">
      <li><span class="fperkic">${IC.spark}</span><span><b>Shubix edits it for you</b><small>Finds the best moments and cuts them on the beat</small></span></li>
      <li><span class="fperkic">${IC.lock}</span><span><b>Private by design</b><small>Made on this device. Your videos are never uploaded.</small></span></li>
    </ul>
    <button type="button" class="chatcard" id="chatcard" aria-controls="chatbox"><span class="chatorb" aria-hidden="true">${IC.spark}</span><span class="chatcardt"><b>Ask Shubix</b><small>Tell the AI how to edit: faster, calmer, zooms…</small></span><span class="chatcardgo" aria-hidden="true">${IC.arrow}</span></button>
  </aside>
  </div>

  <section class="fan" id="fan" aria-live="polite">
    <h2>Analysing Clips</h2>
    <div class="aoring"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="fanring" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="326.7"/></svg><b id="fanpct">0%</b></div>
    <p class="fanst"><b id="fant">Reading your clips…</b><small id="fand"></small></p>
    ${aiList("faiList fanList")}
    <p class="fnote fbox">${IC.lock}This happens on your phone. Your videos are never uploaded.</p>
  </section>

  <section class="step locked editor" id="s3">
    <div class="${stepHead} in-[.made]:hidden"><span class="${stepNumber}">4</span><h2 class="${stepTitle}">Your Reel</h2><span class="ml-auto text-[12.5px] text-muted" id="s3st">The edit appears once there are clips</span></div>
    <div class="create">
      <div class="workbench">
        <section class="previewPanel stage">
          <div class="previewHeader">
            <span><i></i> PREVIEW</span>
            <button type="button" class="${Button.small}" id="prevaspbtn"><span id="prevaspv">9:16</span> <span>⌄</span></button>
          </div>
          <div class="previewStage pv">
            <div class="videoFrame pvbox">
              <canvas id="out" width="1080" height="1920"></canvas>
              <div class="refwait" aria-live="polite"><span class="aiorb" aria-hidden="true"></span><b>Reading the Reel to copy</b><small id="refwaitp">its cuts, flickers and transitions…</small></div>
              <div class="aiask" id="aiask" aria-live="polite"><span class="aiorb" aria-hidden="true"></span><b id="aiaskt">Your Reel is waiting for Shubix AI</b><small id="aiaskp"></small><button type="button" class="${Button.primary}" id="aiaskgo">Make it with Shubix AI</button></div>
              <div class="aiwait" aria-live="polite"><span class="aiorb" aria-hidden="true"></span><b>Shubix is making your Reel</b><small>Watching your clips and listening to the song…</small></div>
              <button type="button" class="previewPlay playov" id="playov" aria-label="Play preview"><span class="ic-play">${IC.play}</span><span class="ic-pause"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg></span></button>
              <div class="frameCounter" id="framecounter">01 / 08</div>
            </div>
            <div class="summary" id="summary" hidden>
              <h2 class="sumh">Your Reel is ready</h2>
              <p class="sumi" id="suminfo"></p>
              <button type="button" class="${Button.secondary}" data-proxy="remix">${IC.mix}</button>
            </div>
          </div>
          <div class="transport">
            <span class="timeCurrent tc" id="tcur">0:00.0</span>
            <span class="timeDivider">/</span>
            <span class="timeTotal tc" id="ttot">0:00.0</span>
            <button class="${Button.icon} size-11 transportSkip" id="pshot" type="button" aria-label="Previous shot">|◂</button>
            <button class="${Button.primary} transportPlay" id="play" disabled aria-label="Play preview"><span class="ic-play">${IC.play}</span><span class="ic-pause"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg></span></button>
            <button class="${Button.icon} size-11 transportSkip" id="nshot" type="button" aria-label="Next shot">▸|</button>
            <span class="transportSpacer"></span>
            <span class="soundState" id="soundstate">${Glyph("Music", 14)} SOUND ON</span>
            <button class="${Button.icon} size-11" id="cover" disabled aria-label="Cover image" title="Cover image" hidden>${IC.image}</button>
            <span class="tr-undo" role="group" aria-label="Undo and redo" hidden><button type="button" class="${Button.icon} size-11" id="tundo" data-proxy="undo" disabled aria-label="Undo">${IC.undo}</button><button type="button" class="${Button.icon} size-11" id="tredo" data-proxy="redo" disabled aria-label="Redo">${IC.redo}</button></span>
            <button class="${Button.icon} size-11" id="remix" disabled aria-label="Mix Video" title="Mix Video: create another edit from the same clips">${IC.mix}<span>Mix Video</span></button>
            <button class="${Button.icon} size-11 ml-1.5" id="pvfull" type="button" aria-label="Full screen" title="Full screen">${I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
          </div>
          <div class="previewProgress bar"><i id="prog" style="width:0%"></i></div>
          <div class="feditbar" hidden><button type="button" class="${Button.primaryLarge}" id="fedit">${IC.pen}<span>Edit</span></button><small>Change shots, effects, text, music and more on the timeline</small></div>
          <label class="tog safe" hidden><input type="checkbox" id="safe" checked> Instagram safe zones (preview only)</label>
          <div class="msg" id="xmsg" hidden></div>
          <div class="row hidden!" id="saverow" hidden><button class="${Button.primary}" id="savevid">Save to Photos / Share</button><a class="${Button.secondary}" id="dlvid">Download</a></div>
          <div class="postcap [:not(#fdcap)>&]:hidden!" id="postcap" hidden>
            <label class="fname" for="postcapt">Caption for your post</label>
            <textarea id="postcapt" rows="4" spellcheck="true"></textarea>
            <div class="row"><button class="${Button.small}" id="postcopy" type="button">Copy caption</button><span class="fname" id="postcapst"></span></div>
          </div>
        </section>

        <aside class="max-[680px]:mx-[-28px] max-[680px]:w-[calc(100%+56px)]! max-[680px]:max-w-none! max-[680px]:rounded-none! max-[680px]:border-x-0! inspector" id="inspector-card">
          <div class="inspectorHead">
            <div><span class="eyebrow">CLIP CONTROLS</span><h2 id="inspect-shot-title">Shot 01</h2></div>
            <span class="durationPill" id="inspect-shot-dur">0.0 s</span>
          </div>
          <div class="shotToolGrid" id="shottoolgrid">
            ${shotToolGridHtml}
          </div>
          <div class="activeToolNote" id="inspect-tool-note"><i class="noteDot"></i> <span id="inspect-tool-text">Transition selected for Shot 01</span></div>
          <div class="inspector-old" id="inspector" hidden></div>
          <div class="shotcard-old" id="shotcard" hidden></div>
        </aside>
      </div>

      <section class="max-[680px]:mx-[-28px] max-[680px]:w-[calc(100%+56px)]! max-[680px]:max-w-none! max-[680px]:rounded-none! max-[680px]:border-x-0! timelineCard" id="timelinecard">
        <header class="timelineHeader">
          <div class="timelineTitle">
            <span class="timelineIcon">${Glyph("Shots", 18)}</span>
            <span><b>Timeline</b><small id="tlsub">8 clips · 5 layers</small></span>
          </div>
          <div class="timelineActions">
            <span class="timelineTime" id="tltime">00:04.8 / 00:29.6</span>
            <button type="button" id="tlzo" aria-label="Zoom out">−</button>
            <span class="zoomValue" id="tlz">100%</span>
            <button type="button" id="tlzi" aria-label="Zoom in">+</button>
            <button type="button" class="${Button.small}" id="tlfit">Fit</button>
            <button class="${Button.small} feditdone" id="feditdone" type="button" hidden>${IC.check} Done</button>
          </div>
        </header>
        <div class="timelineScroll">
          <div class="timelineCanvas">
            <div class="strip" hidden><div class="tlscroll"><canvas id="tl" class="tl" aria-label="Timeline, one block per shot"></canvas></div><div class="tlmusic" id="tlmusic"></div></div>
            <div class="lanesbox"><canvas class="lanes" id="lanes" aria-label="Timeline: effects, video, text, voice and music. Pinch to zoom. Tap a clip to select it, tap it again for its transition, effect and speed; hold a clip and drag it to move it; drag the selected clip's edge to make it longer or shorter"></canvas></div>
          </div>
        </div>
        <footer class="timelineFooter">
          <span><i></i> <span id="psaved-status">All changes saved</span></span>
          <span>Drag clips to rearrange · Select a shot to edit</span>
        </footer>
      </section>

      <div class="tools">
        <nav class="max-[680px]:mx-[-28px] max-[680px]:w-[calc(100%+56px)]! max-[680px]:max-w-none! max-[680px]:rounded-none! max-[680px]:border-x-0! toolDock dock" id="dock" aria-label="Editor tools">${dock}</nav>

        <div class="panels" id="panels">
          <button type="button" class="${Button.iconBordered} absolute top-6 right-5 z-2 size-[34px] max-lg:top-7 max-lg:right-4" id="pclose" aria-label="Close the panel" title="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          <!-- the left panel's tabs on a computer (the design): each opens its tool, Effects / Transitions the shot sheet -->
          <nav class="ptabs" id="ptabs" aria-label="Library">
            <button type="button" data-pt="media" aria-pressed="false">${IC.image}<span>Media</span></button><button type="button" data-pt="music" aria-pressed="false">${IC.music}<span>Music</span></button><button type="button" data-pt="text" aria-pressed="false">${IC.text}<span>Text</span></button><button type="button" data-pt="stickers" aria-pressed="false">${I('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>')}<span>Stickers</span></button><button type="button" data-pt="effects" aria-pressed="false">${IC.spark}<span>Effects</span></button><button type="button" data-pt="transitions" aria-pressed="false">${I('<path d="M4 6l7 6-7 6zM20 6l-7 6 7 6z"/>')}<span>Transitions</span></button><button type="button" data-pt="filters" aria-pressed="false">${I('<path d="M4 6h16M7 12h10M10 18h4"/>')}<span>Filters</span></button>
          </nav>
          <section class="panel" data-panel="media">${panelHead("media")}<div class="mslot" id="mslot"></div></section>
          <section class="panel" data-panel="style">${panelHead("style")}
            <div class="${Segmented.normal}" id="mode">
              <button data-m="auto" aria-pressed="true">Auto</button>
              <button data-m="smooth" aria-pressed="false">Smooth</button>
              <button data-m="fast" aria-pressed="false">Fast</button>
              <button data-m="copy" aria-pressed="false" title="Upload a Reel you like: its pace, transitions, effects and colours are copied onto your clips">Copy a Reel</button>
            </div>
            <input id="reffile" type="file" accept="video/*,.mov,.mp4,.m4v" hidden>
            <div class="refbox" id="refbox" hidden><span class="fname" id="refinfo"></span> <button class="${Button.secondary}" id="refchange" type="button">Change Reel</button><span class="fname refmatch" id="refmatch" hidden></span>
              <div class="row" id="stsaverow" hidden><select id="stcat" aria-label="Kind of Reel"><option value="wedding">Wedding</option><option value="travel">Travel</option><option value="festival">Festival</option><option value="dance">Dance</option><option value="talking">Talking</option><option value="product">Product</option><option value="food">Food</option><option value="fitness">Fitness</option><option value="vlog">Vlog</option><option value="birthday">Birthday</option><option value="car">Car &amp; bike</option><option value="shop">Shop &amp; opening</option><option value="event">Event &amp; party</option><option value="other">Other</option></select><label class="tog"><input type="checkbox" id="stshare"> Share (helps everyone's styles)</label><button class="${Button.small}" id="stsave" type="button">Save to my styles</button><span class="fname" id="ststat"></span></div></div>
            <div class="row learnrow" id="learnrow" hidden><span class="label">Learned style</span><select id="lcat" aria-label="Kind of Reel"></select><div class="${Segmented.normal}" id="lscope"><button data-s="mine" aria-pressed="false">Mine</button><button data-s="all" aria-pressed="true">With shared</button></div><button class="${Button.small}" id="luse" type="button">Use</button><label class="tog"><input type="checkbox" id="lauto"> Use for my next Reels</label><span class="fname" id="linfo"></span>
              <details class="stdetails" id="teach"><summary>Teach Shubix from many Reels</summary><span class="fname">Pick Reels made by real editors: each is read on this phone (the video never leaves it), and what they have in common becomes the learned style of that kind.</span>
                <div class="row"><select id="tcat" aria-label="Kind of Reel"></select><label class="tog"><input type="checkbox" id="tshare"> Share (helps everyone's styles)</label><button class="${Button.small}" id="tpick" type="button">Choose Reels</button><input id="tfiles" type="file" accept="video/*,.mov,.mp4,.m4v" multiple hidden><span class="fname" id="tstat"></span></div></details>
              <details class="stdetails" id="stmine"><summary>My saved styles</summary><ul id="stlist"></ul></details></div>
            <span class="fname" id="modehelp">Auto: the music decides. Calm parts get longer shots, drops and hits get effects.</span>
            <span id="aiwrap" hidden></span><input type="checkbox" id="aipick" hidden aria-hidden="true">
            <span class="fname" id="aistat" hidden></span>
          </section>

          <section class="panel" data-panel="music">${panelHead("music")}
            <div class="row"><button type="button" class="${Button.secondary}" data-open-step="s1">${IC.music}Change the song or its part</button><button type="button" class="${Button.secondary}" data-open-step="s2">${IC.plus}Add or change clips</button></div>
            <div class="clipsnd" id="clipsnd" hidden>
            <b>Your clips have their own sound</b>
            <small>Wind, traffic, people talking… Choose what the Reel keeps under the song.</small>
            <div class="${Segmented.wide}" id="csnd" role="group" aria-label="The clips' own sound">
            <button data-c="mute" aria-pressed="true">Mute it</button><button data-c="voices" aria-pressed="false">Keep voices only</button><button data-c="all" aria-pressed="false">Keep all</button>
            </div>
            </div>
            <div class="ausliders musiconly">
            <label class="cslide"><span>Music volume</span><input type="range" id="mvol" min="0" max="1.5" step="0.05" value="1"><output>100%</output></label>
            <div class="beatmarks"><span class="label">Your beat markers</span>
              <p class="hint">Hear a beat Shubix missed? Pause on it and add a marker: a cut can land there.</p>
              <div class="row"><button class="${Button.small}" id="addbeat" type="button">＋ Add marker at playhead</button><button class="${Button.small}" id="clrbeat" type="button">Remove my markers</button></div></div>
            <label class="tog"><input type="checkbox" id="sfxon" checked> Sound effects on transitions (whoosh, boom, click, pop)</label>
            <label class="cslide"><span>Effects volume</span><input type="range" id="sfxv" min="0" max="1.5" step="0.05" value="0.6"><output>60%</output></label>
            <div class="row" id="sfxadd"><span class="fname">Add at the playhead:</span><button type="button" class="${Button.small}" data-sfx="whoosh">Whoosh</button><button type="button" class="${Button.small}" data-sfx="pop">Pop</button><button type="button" class="${Button.small}" data-sfx="boom">Boom</button><button type="button" class="${Button.small}" data-sfx="click">Click</button><button type="button" class="${Button.small}" data-sfx="riser">Riser</button><button type="button" class="${Button.small}" data-sfx="ding">Ding</button></div>
            <div class="chips" id="sfxlist"></div>
            <label class="cslide"><span>Fade in</span><input type="range" id="mfin" min="0" max="4" step="0.1" value="0"><output>0.0 s</output></label>
            <label class="cslide"><span>Fade out</span><input type="range" id="mfout" min="0" max="4" step="0.1" value="0"><output>0.0 s</output></label>
            <select id="xclip" aria-label="Extract audio: use a clip's sound as the song"><option value="">Use a clip's sound as the song…</option></select>
            <p class="hint">A clip's own sound under the music: Shot → Volume.</p>
            </div>
          </section>

          <section class="panel" data-panel="text">${panelHead("text")}
            <label class="label" for="hook">Hook text (3-5 words, first 2 seconds)</label>
            <input id="hook" type="text" maxlength="40" placeholder="e.g. WAIT FOR THE DROP">
            <span class="label">Text style</span>
            <div class="${Segmented.normal}" id="tstyle"><button data-t="pop" aria-pressed="true">Pop</button><button data-t="karaoke" aria-pressed="false">Karaoke</button><button data-t="box" aria-pressed="false">Box</button><button data-t="clean" aria-pressed="false">Clean</button></div>
            <span class="label">Text &amp; stickers</span>
            <div class="row ovadd">
              <button class="${Button.secondary}" id="ovtext" type="button">+ Text</button><button class="${Button.secondary}" id="ovsticker" type="button">+ Sticker</button>
              <select id="ovpreset" aria-label="Ready-made text"><option value="">+ Ready-made…</option><option value="price">Price tag ₹</option><option value="follow">Follow for more</option><option value="save">Save this</option><option value="step1">Step 1</option><option value="before">BEFORE</option><option value="after">AFTER</option><option value="ganpati">गणपती बाप्पा मोरया</option><option value="diwali">शुभ दीपावली</option><option value="hdiwali">Happy Diwali</option></select>
            </div>
            <div class="emojis" id="emojis" hidden></div>
            <div class="ovlist" id="ovlist"></div>
            <p class="hint" id="ovhint" hidden>Drag a text or sticker on the preview to move it; pinch it with two fingers, or drag its yellow corner, to make it bigger or smaller. Pause the preview where it should start or end.</p>
          </section>

          <section class="panel" data-panel="captions">${panelHead("captions")}
            <label class="tog" id="capwrap" hidden><input type="checkbox" id="caps"> Captions: the words, word by word</label>
            <p class="hint capnone">Captions appear here once a song with words or a talking video is in.</p>
            <div class="row" id="caprow" hidden><select id="caplang" aria-label="Language of the song"><option value="">Language: detect</option><option value="hi">Hindi</option><option value="mr">Marathi</option><option value="en">English</option><option value="gu">Gujarati</option><option value="pa">Punjabi</option><option value="bn">Bengali</option><option value="ta">Tamil</option><option value="te">Telugu</option></select><select id="captr" aria-label="Also show the captions in"><option value="">Translation: off</option><option value="mr">+ मराठी (Marathi)</option><option value="hi">+ हिंदी (Hindi)</option><option value="en">+ English</option><option value="hinglish">+ Hinglish</option><option value="gu">+ ગુજરાતી</option><option value="bn">+ বাংলা</option><option value="ta">+ தமிழ்</option><option value="te">+ తెలుగు</option><option value="pa">+ ਪੰਜਾਬੀ</option></select><label class="tog" id="trwrap" hidden><input type="checkbox" id="tronly"> Only the translation</label><span class="fname" id="capstat"></span><label class="tog" id="kwwrap"><input type="checkbox" id="kwon" checked> Key words + zoom (talking, voiceover)</label></div>
          </section>

          <section class="panel" data-panel="look">${panelHead("look")}
            <label class="tog aitog"><input type="checkbox" id="aitouch" checked> Shubix touch-ups: fit wide clips, fix dark shots, keep voices, one reversed drop, fade out at the end</label>
            <div class="${Segmented.normal}" id="look"><button data-l="natural" aria-pressed="false">Natural</button><button data-l="vivid" aria-pressed="true">Vivid</button><button data-l="cine" aria-pressed="false">Cinematic</button><button data-l="mono" aria-pressed="false">B&amp;W</button><button data-l="copy" aria-pressed="false" hidden>Copied</button></div>
          </section>

          <section class="panel" data-panel="bg">${panelHead("bg")}
            <div class="${Segmented.normal}" id="bgmode" role="group" aria-label="Background behind the person"><button data-b="none" aria-pressed="true">Original</button><button data-b="blur" aria-pressed="false">Blur</button><button data-b="color" aria-pressed="false">Colour</button><button data-b="photo" aria-pressed="false">Photo</button></div>
            <div class="row" id="bgrow" hidden><span class="ovc" id="bgcolors" hidden></span><button class="${Button.small}" id="bgpick" type="button" hidden>Choose photo</button><input id="bgfile" type="file" accept="image/*" hidden></div>
            <span class="fname" id="bgstat"></span>
          </section>

          <section class="panel" data-panel="layers">${panelHead("layers")}
            <div class="row"><button type="button" class="${Button.secondary}" id="lyadd">${IC.plus}Add a video or photo on top</button><input id="lyfile" type="file" accept="video/*,image/*,.mov,.mp4,.jpg,.jpeg,.png,.webp" multiple hidden></div>
            <p class="hint">It starts at the playhead. Picture in picture, split screen, a masked shape, a logo…</p>
            <div class="lylist" id="lylist"></div>
            <div class="lyedit" id="lyedit" hidden>
              <span class="label">Layout</span>
              <div class="chips"><button type="button" class="${Chip}" data-lay="tl"><i class="lyic lay-tl" aria-hidden="true"></i><span>Top left</span></button><button type="button" class="${Chip}" data-lay="tr"><i class="lyic lay-tr" aria-hidden="true"></i><span>Top right</span></button><button type="button" class="${Chip}" data-lay="bl"><i class="lyic lay-bl" aria-hidden="true"></i><span>Bottom left</span></button><button type="button" class="${Chip}" data-lay="br"><i class="lyic lay-br" aria-hidden="true"></i><span>Bottom right</span></button><button type="button" class="${Chip}" data-lay="top"><i class="lyic lay-top" aria-hidden="true"></i><span>Top</span></button><button type="button" class="${Chip}" data-lay="bottom"><i class="lyic lay-bottom" aria-hidden="true"></i><span>Bottom</span></button><button type="button" class="${Chip}" data-lay="left"><i class="lyic lay-left" aria-hidden="true"></i><span>Left</span></button><button type="button" class="${Chip}" data-lay="right"><i class="lyic lay-right" aria-hidden="true"></i><span>Right</span></button><button type="button" class="${Chip}" data-lay="full"><i class="lyic lay-full" aria-hidden="true"></i><span>Full</span></button></div>
              <span class="label">When · <span id="lytime"></span></span>
              <div class="chips"><button type="button" class="${Chip}" data-lyt="start">Start at the playhead</button><button type="button" class="${Chip}" data-lyt="end">End at the playhead</button><button type="button" class="${Chip}" data-lyt="all">Whole Reel</button></div>
              <span class="label">Place</span>
              <label class="cslide"><span>Across</span><input type="range" data-ly="x" min="0" max="1" step="0.01"><output></output></label>
              <label class="cslide"><span>Down</span><input type="range" data-ly="y" min="0" max="1" step="0.01"><output></output></label>
              <label class="cslide"><span>Size</span><input type="range" data-ly="s" min="0.1" max="1.2" step="0.01"><output></output></label>
              <label class="cslide"><span>Rotate</span><input type="range" data-ly="r" min="-180" max="180" step="1"><output></output></label>
              <label class="cslide"><span>Opacity</span><input type="range" data-ly="op" min="0" max="1" step="0.05"><output></output></label>
              <label class="cslide"><span>Corners</span><input type="range" data-ly="rad" min="0" max="1" step="0.05"><output></output></label>
              <div class="chips"><button type="button" class="${Chip}" data-lyf="fh">Mirror</button><button type="button" class="${Chip}" data-lyf="fv">Flip</button></div>
              <span class="label">Mask</span>
              <div class="chips" id="lymask"><button type="button" class="${Chip}" data-m="none"><i class="lyic mk-none" aria-hidden="true"></i><span>None</span></button><button type="button" class="${Chip}" data-m="circle"><i class="lyic mk-circle" aria-hidden="true"></i><span>Ellipse</span></button><button type="button" class="${Chip}" data-m="rect"><i class="lyic mk-rect" aria-hidden="true"></i><span>Rectangle</span></button><button type="button" class="${Chip}" data-m="polygon"><i class="lyic mk-polygon" aria-hidden="true"></i><span>Polygon</span></button><button type="button" class="${Chip}" data-m="line"><i class="lyic mk-line" aria-hidden="true"></i><span>Linear</span></button><button type="button" class="${Chip}" data-m="radial"><i class="lyic mk-radial" aria-hidden="true"></i><span>Radial</span></button><button type="button" class="${Chip}" data-m="luma"><i class="lyic mk-luma" aria-hidden="true"></i><span>Luma</span></button><button type="button" class="${Chip}" data-m="mirror"><i class="lyic mk-mirror" aria-hidden="true"></i><span>Mirror</span></button></div>
              <div id="lymaskopts">
                <label class="cslide"><span>Width</span><input type="range" data-ly="mk.w" min="0.05" max="1.5" step="0.01"><output></output></label>
                <label class="cslide"><span>Height</span><input type="range" data-ly="mk.h" min="0.05" max="1.5" step="0.01"><output></output></label>
                <label class="cslide" id="lylumarow"><span>Luma threshold</span><input type="range" data-ly="mk.th" min="0" max="1" step="0.01"><output></output></label>
                <label class="cslide"><span>Angle</span><input type="range" data-ly="mk.a" min="-90" max="90" step="1"><output></output></label>
                <label class="cslide"><span>Feather</span><input type="range" data-ly="mk.f" min="0" max="0.6" step="0.01"><output></output></label>
                <label class="tog"><input type="checkbox" data-ly="mk.inv"> Invert (cut the shape out)</label>
              </div>
              <span class="label">Crop</span>
              <label class="cslide"><span>Left</span><input type="range" data-ly="crop.l" min="0" max="0.45" step="0.01"><output></output></label>
              <label class="cslide"><span>Right</span><input type="range" data-ly="crop.r" min="0" max="0.45" step="0.01"><output></output></label>
              <label class="cslide"><span>Top</span><input type="range" data-ly="crop.t" min="0" max="0.45" step="0.01"><output></output></label>
              <label class="cslide"><span>Bottom</span><input type="range" data-ly="crop.b" min="0" max="0.45" step="0.01"><output></output></label>
              <span class="label">Fade</span>
              <label class="cslide"><span>Fade in</span><input type="range" data-ly="fin" min="0" max="2" step="0.1"><output></output></label>
              <label class="cslide"><span>Fade out</span><input type="range" data-ly="fout" min="0" max="2" step="0.1"><output></output></label>
              <label class="cslide" id="lyvolrow"><span>Its sound</span><input type="range" data-ly="vol" min="0" max="2" step="0.05"><output></output></label>
              <label class="cslide"><span>Blend</span><select data-ly="blend" aria-label="Blend mode"><option value="source-over">Normal</option><option value="screen">Screen (light leaks, dust)</option><option value="multiply">Multiply</option><option value="overlay">Overlay</option><option value="soft-light">Soft light</option><option value="lighten">Lighten</option><option value="darken">Darken</option><option value="color-dodge">Colour dodge</option><option value="difference">Difference</option></select></label>
              <div class="row"><label class="tog"><input type="checkbox" data-ly="key.on"> Green screen (chroma key)</label><button type="button" class="${Button.small}" data-lykey="#00FF00"><i class="keydot" style="background:#00FF00" aria-hidden="true"></i>Green</button><button type="button" class="${Button.small}" data-lykey="#0047FF"><i class="keydot" style="background:#0047FF" aria-hidden="true"></i>Blue</button><button type="button" class="${Button.small}" data-lykey="#000000"><i class="keydot" style="background:#000000" aria-hidden="true"></i>Black</button><button type="button" class="${Button.small}" data-lykey="#FFFFFF"><i class="keydot" style="background:#FFFFFF" aria-hidden="true"></i>White</button></div>
              <label class="cslide"><span>Key strength</span><input type="range" data-ly="key.tol" min="0" max="1" step="0.05"><output></output></label>
              <button type="button" class="${Button.ghost}" data-lydel="1">Remove this layer</button>
            </div>
          </section>

          <section class="panel" data-panel="voice">${panelHead("voice")}
            <div class="row vorow" id="vorow"><button class="${Button.secondary}" id="vorec" type="button">${IC.voice}Record voiceover</button><button class="${Button.small}" id="vodel" type="button" hidden>Remove voiceover</button><label class="tog"><input type="checkbox" id="dn2" checked> Clean up noise</label><span class="fname" id="vostat"></span></div>
            <div class="ttsbox musiconly" id="ttsbox">
              <label class="label" for="ttstext">Text to speech</label>
              <textarea id="ttstext" rows="2" maxlength="1200" placeholder="Type what the voice should say… (English, हिन्दी, मराठी, తెలుగు, മലയാളം)"></textarea>
              <div class="row"><select id="ttsvoice" aria-label="Voice"></select><button type="button" class="${Button.secondary}" id="ttsadd">${IC.voice}Add at the playhead</button></div>
              <p class="hint">Made on this phone. Each voice is downloaded once (about 60 MB).</p>
              <div class="ttslist" id="ttslist"></div>
            </div>
            <span class="label musiconly">Voice changer</span>
            <div class="chips musiconly" id="vfx" role="group" aria-label="Voice changer"><button type="button" class="${Chip}" data-f="none" aria-pressed="true">Original</button><button type="button" class="${Chip}" data-f="deep" aria-pressed="false">Deep</button><button type="button" class="${Chip}" data-f="chipmunk" aria-pressed="false">Chipmunk</button><button type="button" class="${Chip}" data-f="robot" aria-pressed="false">Robot</button><button type="button" class="${Chip}" data-f="radio" aria-pressed="false">Radio</button><button type="button" class="${Chip}" data-f="echo" aria-pressed="false">Echo</button></div>
            <p class="hint talkonly">Talking videos: pauses, music under the voice and noise cleanup are in step 2.</p>
          </section>

          <section class="panel" data-panel="motion">${panelHead("motion")}
            <details class="kfbox" id="kfbox"><summary>Keyframes: move, zoom, turn, fade a shot or a text</summary>
              <div class="kfhead"><span class="fname" id="kftarget"></span><select id="kfpreset" aria-label="Ready-made move"><option value="">Ready-made move…</option></select></div>
              <canvas id="kftl" class="kftl" aria-label="Keyframes of the shot or text; tap to move the playhead"></canvas>
              <div class="row kfbtns"><button class="${Button.small}" id="kfprev" type="button" aria-label="Previous keyframe">◀ ◆</button><button class="${Button.small}" id="kfadd" type="button">◇ Add keyframe</button><button class="${Button.small}" id="kfnext" type="button" aria-label="Next keyframe">◆ ▶</button><select id="kfease" aria-label="Ease into this keyframe"></select><button class="${Button.small}" id="kfdel" type="button">Delete ◆</button><button class="${Button.small}" id="kfclear" type="button">Clear all</button><button class="${Button.small}" id="kfcopy" type="button">Copy</button><button class="${Button.small}" id="kfpaste" type="button">Paste</button></div>
              <div class="kfsliders" id="kfsliders"></div>
              <span class="label kfml">Ready-made moves</span>
              <div class="kfmoves" id="kfmoves"></div>
              <p class="hint"><span id="kfinfo"></span>. Tap a text or sticker to animate it, otherwise the shot under the playhead. Pause where the move starts and set it; move the playhead and set it again. Drag the picture to move it. Double-tap a slider to reset it.</p>
            </details>
          </section>

          <button type="button" class="${Button.primaryLarge} fapply" id="fapply">${IC.check} Done</button>
          <section class="panel wide" data-panel="shots">
            <div class="shotcard" id="shotcard"></div>
            <details class="allshots" id="allshots"><summary>All shots</summary>
              <p class="note">One row per shot. Change any shot's transition, effect or speed, or press ↻ for a different moment. The rest of the edit stays, and no moment of footage is used twice.</p>
              <div class="edl"><table><thead><tr><th>Time</th><th>Type</th><th>Clip</th><th>Transition</th><th>Effect</th><th>Speed</th></tr></thead><tbody id="edl"></tbody></table></div>
            </details>
          </section>
          <footer class="sheetFooter pfoot"><span><i aria-hidden="true"></i>Changes show in the preview right away</span><button type="button" class="${Button.primary}" id="pdone">Done ${IC.check}</button></footer>
        </div>
      </div>
    </div>
  </section>
</div>
<div class="savebar in-[.fopen]:hidden!" id="savebar">
  <button class="${Button.primaryLarge}" id="export" disabled>${IC.save}<span>Export</span></button>
</div>
<!-- a saved Reel opening (/create/edit?p=): engine.ts openProject; flow.ts shows it from the first paint -->
<div class="openload" id="openload" role="status" aria-live="polite"><span class="openspin" aria-hidden="true"></span><b id="openh">Opening your Reel…</b><small id="openstep">Getting the song and the clips</small><a class="${Button.secondary}" href="/reels" id="openback">Back to My Reels</a></div>
<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
<!-- the shot sheet: a shot tapped on the timeline (views.ts): over the clip on a computer, from the bottom on a phone -->
<!-- credits: asked before Shubix AI uses them (an AI Reel, a chat change); Free: the plans -->
<div class="cconf" id="cconf" hidden><div class="cconfb" role="dialog" aria-modal="true" aria-labelledby="cconft">
  <button type="button" class="${Button.close} absolute top-2.5 right-2.5" id="cconfx" aria-label="Close" title="Close">${I('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
  <span class="cconfi" aria-hidden="true">${IC.spark}</span>
  <b id="cconft"></b><p id="cconfp"></p><ul class="cconfl" id="cconfl" hidden></ul><p class="cconfbal" id="cconfbal"></p>
  <div class="cconfa"><button type="button" class="${Button.secondary}" id="cconfno"></button><button type="button" class="${Button.primary}" id="cconfok"></button></div>
</div></div>
<div class="clipbar" id="clipbar" hidden role="toolbar" aria-label="Selected clip"></div>
<section class="ctpop" id="ctpop" hidden role="dialog" aria-labelledby="ctpoph">
  <div class="ctpoph sheetHeader"><span class="sheetHeading"><span class="sheetIcon" id="ctpopic"></span><span><small id="ctpopsub">SHOT 01</small><b id="ctpoph"></b></span></span><span class="ctpopbtns"><button type="button" class="${Button.iconBordered} size-[34px] max-lg:hidden" id="ctpopx" aria-label="Cancel" title="Cancel">${I('<path d="M6 6l12 12M18 6L6 18"/>')}</button></span></div>
  <p class="sheetDescription">Adjust this shot. Your changes show in the preview right away.</p>
  <div class="ctpopb" id="ctpopb"></div>
  <footer class="sheetFooter"><span><i aria-hidden="true"></i><span id="ctpopfoot">Preview selection</span></span><button type="button" class="${Button.primary}" id="ctpopok" title="Apply">Done ${IC.check}</button></footer>
</section>
<section class="shotsheet" id="shotsheet" hidden role="dialog" aria-label="Shot">
  <div class="ss-head"><span class="ss-grip" aria-hidden="true"></span><button type="button" class="${Button.close} absolute top-3 right-3" id="ssx" aria-label="Cancel" title="Cancel">${I('<path d="M6 6l12 12M18 6L6 18"/>')}</button></div>
  <div class="ss-body shotcard" id="ssbody"></div>
  <footer class="sheetFooter"><span><i aria-hidden="true"></i><span id="ssfoot">Preview selection</span></span><button type="button" class="${Button.iconPrimary} size-[34px] max-lg:hidden" id="ssok" title="Apply">Done ${IC.check}</button></footer>
  <span class="ss-rs" aria-hidden="true" title="Drag to resize"></span>
</section>
<section class="fexp" id="fexp" hidden aria-live="polite" aria-labelledby="fexph">
  <h2 id="fexph">Exporting</h2>
  <div class="aoring"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" id="fexpring" cx="60" cy="60" r="52" stroke-dasharray="326.7" stroke-dashoffset="326.7"/></svg><b id="fexppct">0%</b></div>
  <p class="fanst"><b>Making your Reel…</b><small>This may take a few moments. Please keep this screen open.</small></p>
  <ul class="faiList fanList" id="fexplist"><li data-at="0.02">${IC.scan}<span>Preparing clips</span></li><li data-at="0.3">${IC.spark}<span>Applying effects</span></li><li data-at="0.85">${IC.image}<span>Rendering video</span></li><li data-at="1">${IC.music}<span>Finalizing audio</span></li></ul>
  <button type="button" class="${Button.secondary} mx-auto mt-2" id="fexpcancel">Cancel export</button>
</section>
<section class="fdone" id="fdone" hidden aria-labelledby="fdoneh">
  <div class="fdhead"><button type="button" class="${Button.iconBordered} size-11 max-lg:size-10" data-fd="close" aria-label="Back to your Reel">${IC.back}</button></div>
  <span class="fconf" aria-hidden="true">🎉</span>
  <h2 id="fdoneh">Reel Exported!</h2>
  <div class="fdvid"><video id="fdvideo" playsinline controls preload="metadata"></video></div>
  <p class="fdsaved"><b>Saved to your phone</b><small id="fdsize"></small></p>
  <button type="button" class="${Button.primaryLarge}" data-fd="share">${IC.upload}Share</button>
  <button type="button" class="${Button.large}" data-fd="save">${IC.save}Save to Photos</button>
  <button type="button" class="${Button.large}" data-fd="download">${IC.save}Download</button>
  <div class="fdcap" id="fdcap"><b>Caption for your Post</b></div>
</section>
<div class="xsheet max-lg:overflow-y-auto max-lg:overscroll-contain" id="xsheet" hidden>
  <div class="xsh" role="dialog" aria-modal="true" aria-labelledby="xsht">
    <div class="xprev relative overflow-hidden bg-black max-lg:[&[src]]:mx-auto! max-lg:[&[src]]:block! max-lg:[&[src]]:h-[266px] max-lg:[&[src]]:w-[150px] max-lg:[&[src]]:rounded-2xl" id="xprev"><canvas id="xprevc" class="block size-full object-contain"></canvas><button type="button" id="xprevplay" class="absolute inset-0 m-auto grid size-14 place-items-center rounded-full border-2 border-white/80 bg-black/45 text-white [&>svg]:size-6" aria-label="Play the Reel">${IC.play}</button></div>
    <div class="xsh-h max-lg:-order-1"><h2 id="xsht">Export Your Reel</h2><button type="button" class="${Button.iconBordered} size-[34px]" id="xshclose" aria-label="Close">✕</button></div>
    <p class="xsh-l">Quality</p>
    <div class="${Segmented.wide} grid! grid-flow-col auto-cols-fr gap-2.5 border-0! bg-transparent! p-0! overflow-visible [&>button]:grid! [&>button]:place-items-center [&>button]:content-center [&>button]:gap-0.5 [&>button]:min-h-[76px] [&>button]:rounded-[14px]! [&>button]:border! [&>button]:border-border [&>button]:bg-surface-2 [&>button]:text-[15px] [&>button]:font-semibold [&>button]:text-foreground [&>button[aria-pressed=true]]:border-accent! [&>button[aria-pressed=true]]:bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface-2))] [&>button]:after:text-[11.5px] [&>button]:after:font-medium [&>button]:after:text-muted [&>button]:after:block [&>button:disabled]:opacity-40" id="xres" role="group" aria-label="Quality"><button type="button" data-r="720">720p</button><button type="button" data-r="1080" aria-pressed="true">1080p</button><button type="button" data-r="4k">4K</button></div>
    <p class="xsh-l">Frame rate</p>
    <div class="${Segmented.wide} grid! grid-flow-col auto-cols-fr gap-2.5 border-0! bg-transparent! p-0! overflow-visible [&>button]:grid! [&>button]:place-items-center [&>button]:content-center [&>button]:gap-0.5 [&>button]:min-h-[76px] [&>button]:rounded-[14px]! [&>button]:border! [&>button]:border-border [&>button]:bg-surface-2 [&>button]:text-[15px] [&>button]:font-semibold [&>button]:text-foreground [&>button[aria-pressed=true]]:border-accent! [&>button[aria-pressed=true]]:bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface-2))] [&>button]:after:text-[11.5px] [&>button]:after:font-medium [&>button]:after:text-muted [&>button]:after:block [&>button:disabled]:opacity-40" id="xfps" role="group" aria-label="Frame rate"><button type="button" data-f="30" aria-pressed="true">30 fps</button><button type="button" data-f="60">60 fps</button></div>
    <p class="xsh-size" id="xsize"></p>
    <label class="xtog"><span class="xti">${I('<path d="M4 7h16M4 12h10M4 17h7"/><path d="M15 15l5 5M20 15l-5 5"/>')}</span><span class="xtt">Remove Watermark <a class="xpro" id="xwmpro" href="/pricing" title="Paid plans can remove the watermark">Pro</a></span><input type="checkbox" id="xwm" role="switch"><i aria-hidden="true"></i></label>
    <label class="xtog" id="xmyrow" hidden><span class="xti">${I('<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/>')}</span><span class="xtt">Save to My Reels</span><input type="checkbox" id="xmy" role="switch" checked><i aria-hidden="true"></i></label>
    <label class="xtog" title="For adding the same song as Instagram's own sound (trending audio)"><span class="xti">${IC.music}</span><span class="xtt">Without the song <small>Add it in Instagram as its own sound</small></span><input type="checkbox" id="nosong" role="switch"><i aria-hidden="true"></i></label>
    <button type="button" class="${Button.primaryLarge} max-lg:sticky max-lg:bottom-3 max-lg:z-10 max-lg:shadow-[0_10px_30px_-8px_rgba(0,0,0,.55)]" id="xgo">${IC.save}<span>Export to phone</span></button>
    <button type="button" class="${Button.large}" id="xgocloud" hidden><span>Export &amp; save to My Reels</span></button>
    <p class="xsh-note" id="xcloudnote" hidden></p>
  </div>
</div>
<!-- Ask Shubix: tell the AI in your own words how the Reel should be; it edits the Reel that way (engine.ts, chat) -->
<button type="button" class="chatfab" id="chatfab" aria-expanded="false" aria-controls="chatbox">${IC.spark}<span>Ask Shubix</span></button>
<section class="chatbox" id="chatbox" role="dialog" aria-labelledby="chath" hidden>
  <span class="chatgrab" aria-hidden="true"></span>
  <div class="chath">
    <span class="chatorb" aria-hidden="true">${IC.spark}</span>
    <span class="chatttl"><b id="chath">Ask Shubix</b><small>Your AI editor · changes this Reel</small></span>
    <button type="button" class="${Button.close} shrink-0" id="chatclose" aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>
  <div class="chatlog" id="chatlog" aria-live="polite"></div>
  <span class="chatideas">Quick ideas</span>
  <div class="chatchips" id="chatchips">
    <button type="button" data-say="Make it faster and more energetic">Faster</button>
    <button type="button" data-say="Make it calm and cinematic, slower cuts">Calmer</button>
    <button type="button" data-say="Add more zooms and camera moves on the beats">More zooms</button>
    <button type="button" data-say="More transitions">More transitions</button>
    <button type="button" data-say="Keep it clean: fewer effects, simple cuts">Cleaner</button>
    <button type="button" data-say="Make a completely different version">New version</button>
  </div>
  <form class="chatform" id="chatform">
    <div class="chatfield">
      <textarea id="chatin" rows="1" maxlength="300" placeholder="Describe a change… e.g. zoom on the drop"></textarea>
      <button type="submit" class="${Button.iconPrimary} size-9" id="chatsend" aria-label="Send"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
    </div>
    <small class="chathint">Enter to send · Shift + Enter for a new line</small>
  </form>
</section>`;
