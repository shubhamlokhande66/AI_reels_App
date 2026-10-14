/** The manual editor's live preview: the renderer's effects and transitions redrawn in the browser with the renderer's
 * own numbers and timing (backend video/cutter.py, video/composer.py), so the preview matches the exported video. */

export const pretty = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** CSS filter per colour look (backend video/grades.py). */
export const LOOK_CSS: Record<string, string> = {
  natural: "contrast(1.02) saturate(1.03)",
  clean: "contrast(1.05) brightness(1.03)",
  warm: "sepia(0.18) saturate(1.12) hue-rotate(-6deg)",
  cinematic: "contrast(1.1) saturate(0.88) hue-rotate(-8deg)",
  luxury: "contrast(1.12) saturate(0.95) brightness(0.97) sepia(0.08)",
  high_contrast: "contrast(1.22) saturate(1.12)",
  soft: "contrast(0.94) saturate(0.9) brightness(1.04)",
  vintage: "sepia(0.35) contrast(0.95) saturate(0.85) brightness(1.03)",
  black_white: "grayscale(1) contrast(1.08)",
  sepia: "sepia(0.9)",
  cool: "saturate(1.02) hue-rotate(12deg) brightness(1.01)",
  golden_hour: "sepia(0.25) saturate(1.2) brightness(1.04) hue-rotate(-10deg)",
  faded_film: "contrast(0.86) saturate(0.85) brightness(1.06)",
  noir: "grayscale(1) contrast(1.38) brightness(0.96)",
  neon: "contrast(1.15) saturate(1.5)",
  retro: "sepia(0.4) saturate(1.1) contrast(0.95)",
  crisp: "contrast(1.1) saturate(1.06)",
  dreamy: "contrast(0.9) brightness(1.07) saturate(1.08)",
  emerald: "saturate(1.05) hue-rotate(-14deg)",
  rose: "sepia(0.1) saturate(0.95) hue-rotate(-12deg) brightness(1.03)",
};

// The renderer's own numbers (backend video/cutter.py): the preview moves exactly like the exported video.
const ZOOM_AMOUNT = 0.08;
const PUNCH_AMOUNT = 0.1;
const PUNCH_SECONDS = 0.25;
const PULSE_AMOUNT = 0.035;
const PULSE_PERIOD = 0.6;
const PAN_SCALE = 1.14;
const MOTION_SCALE = 1.12;
const SHAKE_AMOUNT = 0.7;
const ROLL_RADIANS = 0.035;
const ROLL_PERIOD = 2.4;
const CRASH_AMOUNT = 0.3;
const CRASH_SECONDS = 0.25;
const KEN_BURNS_AMOUNT = 0.12;
const FLASH_STRENGTH = 0.55;
const FLASH_SECONDS = 0.2;
const HIT_PULSE_AMOUNT = 0.045;
const HIT_PULSE_DECAY = 0.2;
const HIT_PUNCH_AMOUNT = 0.06;
const HIT_PUNCH_DECAY = 0.16;
const STUTTER_AMOUNT = 0.05;
const STUTTER_DECAY = 0.08;
const HIT_FLASH_STRENGTH = 0.28;
const HIT_FLASH_DECAY = 0.12;

/** 0..1 that jumps to 1 on every hit and fades over ``decay`` seconds (cutter._hit_envelope). */
function hitEnvelope(hits: number[], decay: number, t: number): number {
  let v = 0;
  for (const h of hits) if (t >= h) v += Math.max(0, 1 - (t - h) / decay);
  return Math.min(1, v);
}

/** The renderer's scale factor at ``t`` seconds into a shot of ``length`` seconds (cutter.zoom_expression). */
function zoomFactor(effect: string, t: number, length: number, hits: number[]): number | null {
  const d = Math.max(length, 0.1);
  if (effect === "zoom_pulse" && hits.length) return 1 + HIT_PULSE_AMOUNT * hitEnvelope(hits, HIT_PULSE_DECAY, t);
  if (effect === "beat_stutter" && hits.length) return 1 + STUTTER_AMOUNT * hitEnvelope(hits, STUTTER_DECAY, t);
  if ((effect === "beat_punch" || effect === "beat_stutter") && hits.length) return 1 + HIT_PUNCH_AMOUNT * hitEnvelope(hits, HIT_PUNCH_DECAY, t);
  const e = effect === "beat_punch" || effect === "beat_stutter" ? "punch" : effect;
  if (e === "zoom_in") return 1 + ZOOM_AMOUNT * Math.min(t / d, 1);
  if (e === "zoom_out") return 1 + ZOOM_AMOUNT * (1 - Math.min(t / d, 1));
  if (e === "punch") return 1 + PUNCH_AMOUNT * Math.max(0, 1 - t / PUNCH_SECONDS);
  if (e === "punch_out") return 1 + PUNCH_AMOUNT * Math.max(0, 1 - (d - t) / PUNCH_SECONDS);
  if (e === "zoom_pulse") return 1 + PULSE_AMOUNT * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / PULSE_PERIOD));
  if (e === "crash_zoom") {
    const crash = 1 + CRASH_AMOUNT * Math.min(t / CRASH_SECONDS, 1);
    return hits.length ? crash * (1 + STUTTER_AMOUNT * hitEnvelope(hits, STUTTER_DECAY, t)) : crash;
  }
  if (e === "ken_burns") return 1 + KEN_BURNS_AMOUNT * Math.min(t / d, 1);
  return null;
}

/** The picture's transform / filter ``secs`` seconds into a shot of ``length`` seconds, exactly as the renderer moves it.
 * ``hits``: the song's hits inside the shot (seconds from its start), which the beat effects follow. */
export function effectStyle(effect: string, p: number, secs: number, length?: number, hits: number[] = []): { transform: string; filter: string } {
  const len = length ?? (p > 0 ? secs / p : 1);
  const t = Math.max(secs, 0);
  let s = 1;
  let x = 0;
  let y = 0;
  let r = 0;
  let filter = "";
  const z = zoomFactor(effect, t, len, hits);
  if (z !== null) {
    s = z;
    if (effect === "ken_burns") {
      // the crop window travels from the bottom-left to the top-right of the enlarged frame
      const q = Math.min(t / Math.max(len, 0.1), 1);
      x = (s - 1) * (0.5 - q) * 100;
      y = (s - 1) * (q - 0.5) * 100;
    }
  } else if (effect.startsWith("pan_")) {
    const q = Math.min(t / Math.max(len, 0.1), 1);
    const pe = 0.5 - 0.5 * Math.cos(Math.PI * q);
    s = PAN_SCALE;
    const m = (s - 1) * 100;
    if (effect === "pan_right") x = m * (0.5 - pe);
    if (effect === "pan_left") x = m * (pe - 0.5);
    if (effect === "pan_down") y = m * (0.5 - pe);
    if (effect === "pan_up") y = m * (pe - 0.5);
  } else if (effect === "shake") {
    s = MOTION_SCALE;
    x = (-(s - 1) / 2) * SHAKE_AMOUNT * Math.sin(2 * Math.PI * t * 6.3) * 100;
    y = (-(s - 1) / 2) * SHAKE_AMOUNT * Math.cos(2 * Math.PI * t * 8.7) * 100;
  } else if (effect === "roll") {
    s = MOTION_SCALE;
    r = ((ROLL_RADIANS * 180) / Math.PI) * Math.sin((2 * Math.PI * t) / ROLL_PERIOD);
  }
  // looks (cutter.look_filters); a flash is drawn as a white layer (flashAmount), not a brightness filter
  if (effect === "black_white") filter = "grayscale(1)";
  else if (effect === "glow") filter = "brightness(1.08) saturate(1.15) contrast(0.96)";
  else if (effect === "sharpen") filter = "contrast(1.06)";
  return { transform: `translate(${x}%, ${y}%) scale(${s}) rotate(${r}deg)`, filter };
}

// ------------------------------------------------------------------ keyframes (backend video/keyframes.py, same math)
type KfProp = "zoom" | "x" | "y" | "rotation" | "opacity" | "blur" | "brightness" | "speed";
const KF_PROPS: KfProp[] = ["zoom", "x", "y", "rotation", "opacity", "blur", "brightness", "speed"];
const KF_RANGE: Record<KfProp, [number, number]> = {
  zoom: [1, 3], x: [-1, 1], y: [-1, 1], rotation: [-20, 20], opacity: [0, 1], blur: [0, 1], brightness: [-0.5, 0.5], speed: [0.25, 4],
};
type Kf = { t: number; ease: string } & Partial<Record<KfProp, number | null>>;

function ease(p: number, e: string): number {
  const q = Math.min(Math.max(p, 0), 1);
  if (e === "ease_in") return q * q;
  if (e === "ease_out") return q * (2 - q);
  if (e === "ease_in_out") return 0.5 - 0.5 * Math.cos(Math.PI * q); // the renderer's slider curve
  if (e === "hold") return q >= 1 ? 1 : 0;
  return q;
}

/** The keyframes made safe like the renderer does: inside the shot, in order, values in range. */
export function validKeyframes(kfs: Kf[], length: number): Kf[] {
  return [...kfs]
    .sort((a, b) => a.t - b.t)
    .map((k) => {
      const out: Kf = { t: Math.min(Math.max(k.t, 0), Math.max(length, 0)), ease: k.ease };
      for (const p of KF_PROPS) {
        const v = k[p];
        if (v !== null && v !== undefined && Number.isFinite(v)) out[p] = Math.min(Math.max(v, KF_RANGE[p][0]), KF_RANGE[p][1]);
      }
      return out;
    });
}

/** A property's value at ``t`` from the keyframes that set it (before the first: its value; after the last: its value). */
export function trackValue(kfs: Kf[], prop: KfProp, t: number, fallback: number): number {
  const track = kfs.filter((k) => k[prop] !== null && k[prop] !== undefined);
  if (!track.length) return fallback;
  let v = track[0][prop] as number;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (t >= b.t) v = b[prop] as number;
    else if (t > a.t) return (a[prop] as number) + ((b[prop] as number) - (a[prop] as number)) * ease((t - a.t) / Math.max(b.t - a.t, 1e-6), b.ease);
  }
  return v;
}

const animatesAny = (kfs: Kf[], props: KfProp[]) => kfs.some((k) => props.some((p) => k[p] !== null && k[p] !== undefined));

/** The renderer's fixed effects as keyframes (video/keyframes.preset), so an effect and hand-made keyframes combine. */
export function presetKeyframes(effect: string, length: number): Kf[] {
  const d = Math.max(length, 0.1);
  const L = "linear";
  if (effect === "zoom_in") return [{ t: 0, zoom: 1, ease: L }, { t: d, zoom: 1 + ZOOM_AMOUNT, ease: L }];
  if (effect === "zoom_out") return [{ t: 0, zoom: 1 + ZOOM_AMOUNT, ease: L }, { t: d, zoom: 1, ease: L }];
  if (effect === "punch") return [{ t: 0, zoom: 1 + PUNCH_AMOUNT, ease: L }, { t: Math.min(PUNCH_SECONDS, d), zoom: 1 + PUNCH_AMOUNT * Math.max(0, 1 - d / PUNCH_SECONDS), ease: L }];
  if (effect === "crash_zoom") return [{ t: 0, zoom: 1, ease: L }, { t: Math.min(CRASH_SECONDS, d), zoom: 1 + CRASH_AMOUNT * Math.min(d / CRASH_SECONDS, 1), ease: L }];
  if (effect === "ken_burns") return [{ t: 0, zoom: 1, x: -1, y: 1, ease: L }, { t: d, zoom: 1 + KEN_BURNS_AMOUNT, x: 1, y: -1, ease: L }];
  const pans: Record<string, [KfProp, number, number]> = { pan_right: ["x", -1, 1], pan_left: ["x", 1, -1], pan_down: ["y", -1, 1], pan_up: ["y", 1, -1] };
  if (pans[effect]) {
    const [axis, a, b] = pans[effect];
    return [{ t: 0, zoom: PAN_SCALE, [axis]: a, ease: L }, { t: d, zoom: PAN_SCALE, [axis]: b, ease: "ease_in_out" }];
  }
  if (effect === "flash") return [{ t: 0, brightness: FLASH_STRENGTH, ease: L }, { t: Math.min(FLASH_SECONDS, d), brightness: 0, ease: L }];
  return [];
}

/** The shot's animation as the renderer builds it: the effect's keyframes with the shot's own keyframes over them. */
export function shotAnimation(effect: string, keyframes: Kf[] | undefined, length: number): Kf[] {
  if (!keyframes?.length) return [];
  const own = validKeyframes(keyframes, length);
  const taken = new Set(KF_PROPS.filter((p) => animatesAny(own, [p])));
  const base = presetKeyframes(effect, length)
    .map((k) => {
      const kept: Kf = { t: k.t, ease: k.ease };
      for (const p of KF_PROPS) if (k[p] !== null && k[p] !== undefined && !taken.has(p)) kept[p] = k[p];
      return kept;
    })
    .filter((k) => animatesAny([k], KF_PROPS));
  return [...base, ...own].sort((a, b) => a.t - b.t);
}

/** The picture at ``t`` seconds into a keyframed shot: the movement (CSS transform), its filter and how much white it
 * adds. ``width``: the player's width in pixels (the blur is measured against the renderer's 1080). */
export function keyframeStyle(anim: Kf[], t: number, width: number): { transform: string | null; filter: string; white: number } {
  let transform: string | null = null;
  if (animatesAny(anim, ["zoom", "x", "y", "rotation"])) {
    const r = trackValue(anim, "rotation", t, 0);
    const rotTrack = anim.filter((k) => k.rotation !== null && k.rotation !== undefined).map((k) => Math.abs(k.rotation as number));
    const a = (Math.max(0, ...rotTrack) * Math.PI) / 180;
    const cover = rotTrack.length ? Math.cos(a) + (16 / 9) * Math.sin(a) : 1; // no corner shows (keyframes._rotation_cover)
    const z = Math.max(trackValue(anim, "zoom", t, 1), cover * (rotTrack.length ? 1.004 : 1));
    const x = trackValue(anim, "x", t, 0);
    const y = trackValue(anim, "y", t, 0);
    // the zoomed picture has (z - 1) / 2 of a frame to spare on each side; x / y say where the window sits in it
    transform = `translate(${(-x * (z - 1) * 50).toFixed(3)}%, ${(-y * (z - 1) * 50).toFixed(3)}%) scale(${z.toFixed(4)}) rotate(${r.toFixed(3)}deg)`;
  }
  const filters: string[] = [];
  const blur = trackValue(anim, "blur", t, 0);
  if (blur > 0.001) filters.push(`blur(${((blur * 12 * width) / 1080 / 2).toFixed(2)}px)`);
  const opacity = trackValue(anim, "opacity", t, 1);
  if (opacity < 0.999) filters.push(`brightness(${opacity.toFixed(3)})`); // towards black, like the renderer
  const bright = trackValue(anim, "brightness", t, 0);
  if (bright < -0.001) filters.push(`brightness(${(1 + bright * 1.6).toFixed(3)})`);
  return { transform, filter: filters.join(" "), white: Math.max(bright, 0) };
}

/** A speed ramp: how much footage has played ``t`` seconds into the shot, and the speed right then (the renderer's
 * video/keyframes.source_seconds). Null when the shot has no speed keyframes. */
export function rampAt(keyframes: Kf[] | undefined, t: number, length: number): { source: number; speed: number } | null {
  const kfs = validKeyframes(keyframes ?? [], length);
  if (!animatesAny(kfs, ["speed"])) return null;
  const n = Math.max(Math.ceil((Math.max(t, 0) / 0.05) * 4), 1);
  const dt = Math.max(t, 0) / n;
  let source = 0;
  for (let i = 0; i < n; i++) source += trackValue(kfs, "speed", (i + 0.5) * dt, 1) * dt;
  return { source, speed: trackValue(kfs, "speed", t, 1) };
}

/** A colour look laid on top of the movement (backend video/cutter.look_filters), as a CSS filter. */
export function lookCss(look: string): string {
  if (look === "black_white") return "grayscale(1)";
  if (look === "glow") return "brightness(1.08) saturate(1.15) contrast(0.96)";
  if (look === "sharpen") return "contrast(1.06)";
  if (look === "vignette") return "contrast(1.03)";
  return "";
}

/** How much white a flash effect adds at ``secs`` into its shot (0..1). The renderer's eq brightness ADDS light, so the
 * preview lays white over the picture with that strength; a CSS brightness() would multiply it (far too bright). */
export function flashAmount(effect: string, secs: number, hits: number[] = []): number {
  const t = Math.max(secs, 0);
  if (effect === "beat_flash" && hits.length) return HIT_FLASH_STRENGTH * hitEnvelope(hits, HIT_FLASH_DECAY, t);
  if (effect === "flash" || effect === "beat_flash") return FLASH_STRENGTH * Math.max(0, 1 - t / FLASH_SECONDS);
  return 0;
}

/** The flash transition (FFmpeg xfade fadewhite): the old shot fades to white, the new one fades in from white. */
export function flashThrough(p: number): number {
  return 1 - Math.abs(2 * Math.min(Math.max(p, 0), 1) - 1);
}

/** The renderer's colour and brightness for a shot (backend services/preview_hints.py) as a CSS filter. */
export function correctionCss(grade: { contrast?: number; saturation?: number; brightness?: number } | undefined, lift = 0, gamma = 0): string {
  const out: string[] = [];
  if (grade?.contrast) out.push(`contrast(${grade.contrast})`);
  if (grade?.saturation) out.push(`saturate(${grade.saturation})`);
  if (grade?.brightness) out.push(`brightness(${1 + 1.6 * grade.brightness})`);
  if (lift > 0) out.push(`brightness(${1 + 2.2 * lift})`); // a dark clip lifted (eq brightness + gamma)
  else if (gamma > 0 && gamma < 1) out.push(`brightness(${gamma})`); // a too-bright clip calmed
  return out.join(" ");
}

/** How the incoming shot appears during a transition, at progress p (0 = starts, 1 = fully in). Approximate families. */
export function transitionStyle(type: string, p: number): { opacity: number; clipPath?: string; transform?: string; filter?: string } {
  const e = Math.min(Math.max(p, 0), 1); // FFmpeg's xfade moves in a straight line
  const pc = (v: number) => `${(v * 100).toFixed(1)}%`;
  if (type.startsWith("wipe_") || type.startsWith("reveal_") || type.startsWith("slice_")) {
    const dir = type.split("_").pop();
    const inset =
      dir === "left" || dir === "tl" || dir === "bl"
        ? `inset(0 0 0 ${pc(1 - e)})`
        : dir === "right" || dir === "tr" || dir === "br"
          ? `inset(0 ${pc(1 - e)} 0 0)`
          : dir === "up"
            ? `inset(${pc(1 - e)} 0 0 0)`
            : `inset(0 0 ${pc(1 - e)} 0)`;
    return { opacity: 1, clipPath: inset };
  }
  if (type.startsWith("slide") || type.startsWith("smooth_") || type.startsWith("cover_")) {
    const dir = type.split("_").pop();
    const d = 1 - e;
    const t = dir === "right" ? `translateX(${-d * 100}%)` : dir === "up" ? `translateY(${d * 100}%)` : dir === "down" ? `translateY(${-d * 100}%)` : `translateX(${d * 100}%)`;
    return { opacity: 1, transform: t };
  }
  if (type.startsWith("circle") || type === "radial") return { opacity: 1, clipPath: `circle(${pc(e * 0.75)} at 50% 50%)` };
  if (type === "rect_crop") return { opacity: 1, clipPath: `inset(${pc((1 - e) / 2)})` };
  if (type.startsWith("vert_")) return { opacity: 1, clipPath: `inset(0 ${pc((1 - e) / 2)})` };
  if (type.startsWith("horz_")) return { opacity: 1, clipPath: `inset(${pc((1 - e) / 2)} 0)` };
  if (type.startsWith("diag_")) return { opacity: 1, clipPath: `polygon(0 0, ${pc(e * 2)} 0, 0 ${pc(e * 2)})` };
  if (type.startsWith("squeeze_")) return { opacity: e, transform: type.endsWith("h") ? `scaleX(${0.3 + 0.7 * e})` : `scaleY(${0.3 + 0.7 * e})` };
  if (type.startsWith("wind_")) return { opacity: e, transform: `skewX(${(1 - e) * (type.endsWith("left") ? 20 : -20)}deg)` };
  if (type === "zoom" || type === "distance") return { opacity: e, transform: `scale(${1.3 - 0.3 * e})` };
  if (type === "blur" || type === "pixelize") return { opacity: e, filter: `blur(${(1 - e) * 12}px)` };
  if (type === "flash") return { opacity: e < 0.5 ? 0 : (e - 0.5) * 2 }; // through white: the white is drawn by the player (flashThrough)
  if (type === "fade_grays") return { opacity: e, filter: `grayscale(${1 - e})` };
  return { opacity: e }; // fade, dissolve, speed ramp ...
}
