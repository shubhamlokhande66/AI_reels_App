/* Clip tools of the current shot (as in VN / CapCut's clip toolbar): one row of tools, the open tool's controls under it.
 * Everything is a field of the shot's settings (the engine's e.cs), so preview, export, Undo and saved Reels all keep it,
 * and the AI can set the same fields. One-tap tools (Rotate, Mirror, Flip, Fit) act at once; the others open controls. */

export type ClipCs = {
  i: number; rev: boolean; zoom: number; cx: number | null; cy: number | null; vol: number; rot: number; fh: boolean; fv: boolean; fit: boolean; bg: string; bgc: string; bd: number; bdc: string;
  bri: number; con: number; sat: number; warm: number; hi?: number; sh?: number; hue?: number; sharp?: number; vig?: number; beauty?: number; fin: number; fout: number;
  mz: { x: number; y: number; w: number; h: number; s: number } | null; mg: { x: number; y: number; r: number; z: number } | null;
};
export type ClipApi = { shotCs: () => ClipCs | null; shotSet: (p: Partial<ClipCs> | null) => void; shotSlip: (d: number) => boolean; shotTrim: (d: number) => boolean; shotExtract: () => unknown; shotReverse: () => Promise<boolean> };

const I = (d: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TOOLS: [string, string, string][] = [
  ["vol", "Volume", I('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>')],
  ["extract", "Extract audio", I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>')],
  ["crop", "Crop", I('<path d="M6 2v16h16M2 6h16v16"/>')],
  ["rev", "Reverse", I('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')],
  ["rot", "Rotate", I('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>')],
  ["fh", "Mirror", I('<path d="M12 3v18M8 7L3 12l5 5zM16 7l5 5-5 5z"/>')],
  ["fv", "Flip", I('<path d="M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z"/>')],
  ["fit", "Fit", I('<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10"/>')],
  ["canvas", "Canvas", I('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>')],
  ["border", "Border", I('<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6.5" y="6.5" width="11" height="11" rx="1"/>')],
  ["adjust", "Adjust", I('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>')],
  ["beauty", "Beauty", I('<circle cx="12" cy="10" r="6"/><path d="M9 9h.01M15 9h.01M9.5 12.5a3.5 3.5 0 0 0 5 0M6 21c1.5-3 4-4 6-4s4.5 1 6 4"/>')],
  ["fade", "Fade", I('<path d="M3 20L12 4l9 16z"/><path d="M12 4v16" stroke-dasharray="2 2"/>')],
  ["mosaic", "Mosaic", I('<rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/>')],
  ["lens", "Magnifier", I('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>')],
  ["slip", "Slip", I('<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>')],
  ["trim", "Trim", I('<path d="M7 4v16M17 4v16M7 12h10"/>')],
];
const SWATCH = ["#000000", "#ffffff", "#f3ede3", "#d4b07a", "#e85d75", "#4f7cff", "#1db954", "#ff9f1c"];
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const slider = (k: string, label: string, v: number, min: number, max: number, step: number, unit = "") =>
  `<label class="cslide"><span>${label}</span><input type="range" data-s="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${fmtV(v, unit)}</output></label>`;
const fmtV = (v: number, unit: string) => unit === "s" ? `${v.toFixed(1)} s` : unit === "x" ? `${v.toFixed(1)}×` : unit === "%" ? `${Math.round(v * 100)}%` : `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
const swatches = (k: string, cur: string) => `<span class="cswatch">${SWATCH.map((c) => `<button type="button" data-col="${k}" data-v="${c}" aria-pressed="${c === cur}" aria-label="Colour ${c}" style="background:${c}"></button>`).join("")}</span>`;
const DEF_MZ = { x: 0.3, y: 0.25, w: 0.4, h: 0.25, s: 0.035 }, DEF_MG = { x: 0.5, y: 0.45, r: 0.18, z: 2 };

/** The row of tools and the open tool's controls */
export function clipToolsHtml(c: ClipCs, open: string): string {
  const on = (k: string) => k === "rev" ? c.rev : k === "crop" ? c.zoom > 1 || c.cx != null : k === "vol" ? c.vol > 0 : k === "rot" ? c.rot !== 0 : k === "fh" ? c.fh : k === "fv" ? c.fv : k === "fit" ? c.fit : k === "canvas" ? c.fit : k === "border" ? c.bd > 0
    : k === "adjust" ? !!(c.bri || c.con || c.sat || c.warm || c.hi || c.sh || c.hue || c.sharp || c.vig) : k === "beauty" ? !!c.beauty : k === "fade" ? c.fin > 0 || c.fout > 0 : k === "mosaic" ? !!c.mz : k === "lens" ? !!c.mg : false;
  const row = `<div class="ctrow" role="toolbar" aria-label="Clip tools">${TOOLS.map(([k, n, ic]) =>
    `<button type="button" class="ct${on(k) ? " on" : ""}" data-ct="${k}" aria-pressed="${open === k}">${ic}<span>${n}${k === "rot" && c.rot ? ` ${c.rot}°` : ""}</span></button>`).join("")}</div>`;
  let body = "";
  const need = (t: string) => `<p class="cnote">${t}</p>`;
  if (open === "vol") body = slider("vol", "Clip sound", c.vol, 0, 2, 0.05, "%") + need("The clip's own sound under the music (0% = the song alone). The music steps back while the clip is loud.");
  else if (open === "extract") body = `<button type="button" class="chip" data-act="extract">Use this clip's sound as the song</button>${need("Its beats then lead the cuts, as with any song. Change it back in Music.")}`;
  else if (open === "crop") body = slider("zoom", "Zoom", c.zoom, 1, 3, 0.05, "x") + slider("cx", "Across", c.cx ?? 0.5, 0, 1, 0.01, "%") + slider("cy", "Down", c.cy ?? 0.5, 0, 1, 0.01, "%")
    + `<button type="button" class="chip" data-act="crop-auto">${c.cx == null ? "Following the face (automatic)" : "Back to automatic (follows the face)"}</button>`;
  else if (open === "canvas") body = !c.fit ? need("Canvas shows around a fitted picture. Turn on Fit first.") + `<button type="button" class="chip" data-act="fit-on">Fit the whole picture</button>`
    : `<div class="chips"><button type="button" class="chip" data-bg="blur" aria-pressed="${c.bg === "blur"}">Blur</button><button type="button" class="chip" data-bg="color" aria-pressed="${c.bg !== "blur"}">Colour</button></div>${c.bg !== "blur" ? swatches("bgc", c.bgc) : ""}`;
  else if (open === "border") body = !c.fit ? need("A border goes around a fitted picture. Turn on Fit first.") + `<button type="button" class="chip" data-act="fit-on">Fit the whole picture</button>`
    : slider("bd", "Width", c.bd, 0, 1, 0.05, "%") + swatches("bdc", c.bdc);
  else if (open === "adjust") body = slider("bri", "Brightness", c.bri, -1, 1, 0.05) + slider("con", "Contrast", c.con, -1, 1, 0.05) + slider("sat", "Saturation", c.sat, -1, 1, 0.05) + slider("warm", "Warmth", c.warm, -1, 1, 0.05)
    + slider("hi", "Highlights", c.hi ?? 0, -1, 1, 0.05) + slider("sh", "Shadows", c.sh ?? 0, -1, 1, 0.05) + slider("hue", "Hue", c.hue ?? 0, -1, 1, 0.02) + slider("sharp", "Sharpen", c.sharp ?? 0, 0, 1, 0.05, "%") + slider("vig", "Vignette", c.vig ?? 0, 0, 1, 0.05, "%");
  else if (open === "beauty") body = slider("beauty", "Smooth skin", c.beauty ?? 0, 0, 1, 0.05, "%") + need("Softens skin and keeps the eyes, hair and edges sharp.");
  else if (open === "fade") body = slider("fin", "Fade in", c.fin, 0, 1.5, 0.1, "s") + slider("fout", "Fade out", c.fout, 0, 1.5, 0.1, "s");
  else if (open === "mosaic") body = !c.mz ? `<button type="button" class="chip" data-act="mz-on">Add mosaic</button>${need("Hides a face, a plate or a logo with blocks.")}`
    : slider("mz.x", "Left", c.mz.x, 0, 0.95, 0.01, "%") + slider("mz.y", "Top", c.mz.y, 0, 0.95, 0.01, "%") + slider("mz.w", "Width", c.mz.w, 0.05, 1, 0.01, "%") + slider("mz.h", "Height", c.mz.h, 0.05, 1, 0.01, "%") + slider("mz.s", "Block size", c.mz.s, 0.01, 0.1, 0.005, "%") + `<button type="button" class="chip" data-act="mz-off">Remove mosaic</button>`;
  else if (open === "lens") body = !c.mg ? `<button type="button" class="chip" data-act="mg-on">Add magnifier</button>${need("A round lens that zooms into one spot.")}`
    : slider("mg.x", "Across", c.mg.x, 0, 1, 0.01, "%") + slider("mg.y", "Down", c.mg.y, 0, 1, 0.01, "%") + slider("mg.r", "Size", c.mg.r, 0.05, 0.45, 0.01, "%") + slider("mg.z", "Zoom", c.mg.z, 1.2, 4, 0.1, "x") + `<button type="button" class="chip" data-act="mg-off">Remove magnifier</button>`;
  else if (open === "slip") body = `<div class="chips"><button type="button" class="chip" data-slip="-1">◀ 1 s earlier</button><button type="button" class="chip" data-slip="-0.25">◀ ¼ s</button><button type="button" class="chip" data-slip="0.25">¼ s ▶</button><button type="button" class="chip" data-slip="1">1 s later ▶</button></div>${need("Shows an earlier or later moment of the same clip. The shot keeps its place on the beat.")}`;
  else if (open === "trim") body = `<div class="chips"><button type="button" class="chip" data-trim="-1">Shorter by a beat</button><button type="button" class="chip" data-trim="1">Longer by a beat</button></div>${need("The cut moves one beat; the next shot starts there.")}`;
  const reset = `<button type="button" class="chip ghost" data-act="reset">Reset this shot</button>`;
  return row + (body ? `<div class="ctbody">${body}</div>` : "") + reset;
}

/** Wires one container: clicks and sliders call the engine; `rerender` draws the tools again after a change */
export function clipToolsEvents(box: HTMLElement, api: () => ClipApi | undefined, getOpen: () => string, setOpen: (k: string) => void, rerender: () => void, sig: AddEventListenerOptions) {
  box.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement, A = api(), c = A?.shotCs(); if (!A || !c) return;
    const ct = t.closest<HTMLElement>("[data-ct]");
    if (ct) {
      const k = ct.dataset.ct!;
      if (k === "rev") { void A.shotReverse().then(rerender); return; }
      if (k === "rot") A.shotSet({ rot: (c.rot + 90) % 360 });
      else if (k === "fh") A.shotSet({ fh: !c.fh });
      else if (k === "fv") A.shotSet({ fv: !c.fv });
      else if (k === "fit") A.shotSet({ fit: !c.fit });
      else setOpen(getOpen() === k ? "" : k);
      rerender(); return;
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "fit-on") A.shotSet({ fit: true });
    else if (act === "mz-on") A.shotSet({ mz: { ...DEF_MZ } });
    else if (act === "mz-off") A.shotSet({ mz: null });
    else if (act === "mg-on") A.shotSet({ mg: { ...DEF_MG } });
    else if (act === "mg-off") A.shotSet({ mg: null });
    else if (act === "reset") A.shotSet(null);
    else if (act === "extract") void A.shotExtract();
    else if (act === "crop-auto") A.shotSet({ zoom: 1, cx: null, cy: null });
    const bg = t.closest<HTMLElement>("[data-bg]")?.dataset.bg; if (bg) A.shotSet({ bg: bg === "blur" ? "blur" : "color" });
    const col = t.closest<HTMLElement>("[data-col]"); if (col) A.shotSet({ [col.dataset.col!]: col.dataset.v } as Partial<ClipCs>);
    const sl = t.closest<HTMLElement>("[data-slip]")?.dataset.slip; if (sl) A.shotSlip(+sl);
    const tr = t.closest<HTMLElement>("[data-trim]")?.dataset.trim; if (tr) A.shotTrim(+tr);
    if (act || bg || col || sl || tr) rerender();
  }, sig);
  // sliders change the picture while they move; the tools are drawn again when they are let go
  const fromSlider = (el: HTMLInputElement) => {
    const A = api(), c = A?.shotCs(); if (!A || !c) return; const k = el.dataset.s!, v = +el.value;
    const out = el.parentElement?.querySelector("output"); if (out) { const unit = /^(fin|fout)$/.test(k) ? "s" : k === "mg.z" || k === "zoom" ? "x" : /^(cx|cy)$/.test(k) ? "%" : /^(bd|mz|mg|vol)/.test(k) ? "%" : ""; out.textContent = fmtV(v, unit); }
    if (k === "cx" || k === "cy") A.shotSet({ cx: k === "cx" ? v : c.cx ?? 0.5, cy: k === "cy" ? v : c.cy ?? 0.5 });
    else if (k.includes(".")) { const [o, f] = k.split(".") as ["mz" | "mg", string]; A.shotSet({ [o]: { ...(c[o] as object), [f]: v } } as Partial<ClipCs>); }
    else A.shotSet({ [k]: v } as Partial<ClipCs>);
  };
  box.addEventListener("input", (ev) => { const el = ev.target as HTMLInputElement; if (el.dataset.s) fromSlider(el); }, sig);
  box.addEventListener("change", (ev) => { const el = ev.target as HTMLInputElement; if (el.dataset.s) rerender(); }, sig);
}
export { esc as escClip };
