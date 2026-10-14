import { KEYFRAME_PROPS, type Keyframe, type KeyframeProp } from "@/server/models/timeline";
import { fixed, g, round, sum as pySum } from "@/server/core/py";

/** The keyframe engine (was backend/app/video/keyframes.py): a shot's animation as keyframes, checked, then rendered
 * by FFmpeg as per-frame expressions. Each property is its own track that moves from keyframe to keyframe with the
 * easing of the later keyframe. */

export const RANGES: Record<KeyframeProp, [number, number]> = {
  zoom: [1, 3], x: [-1, 1], y: [-1, 1], rotation: [-20, 20], opacity: [0, 1], blur: [0, 1], brightness: [-0.5, 0.5], speed: [0.25, 4],
};
export const DEFAULTS: Record<KeyframeProp, number> = { zoom: 1, x: 0, y: 0, rotation: 0, opacity: 1, blur: 0, brightness: 0, speed: 1 };
export const MOTION = ["zoom", "x", "y", "rotation"] as const;
export const MAX_KEYFRAMES = 120;
export const BLUR_SCALE = 12.0;
const SAME_TIME = 0.002;

// the renderer's own effect numbers (video/cutter.py)
export const ZOOM_AMOUNT = 0.08, PUNCH_AMOUNT = 0.1, PUNCH_SECONDS = 0.25, PAN_SCALE = 1.14, CRASH_AMOUNT = 0.3, CRASH_SECONDS = 0.25;
export const KEN_BURNS_AMOUNT = 0.12, FLASH_STRENGTH = 0.55, FLASH_SECONDS = 0.2;

type Ease = Keyframe["ease"];
type Track = [number, number, Ease][];

/** A keyframe with only the given properties set (the rest null), like Keyframe(t=..., **values). */
export function kf(t: number, values: Partial<Record<KeyframeProp, number>>, ease: Ease = "linear"): Keyframe {
  const k = { t, ease } as Keyframe;
  for (const p of KEYFRAME_PROPS) (k as Record<string, unknown>)[p] = values[p] ?? null;
  return k;
}

const setValues = (k: Keyframe) => Object.fromEntries(KEYFRAME_PROPS.filter((p) => k[p] !== null && k[p] !== undefined).map((p) => [p, k[p] as number]));

/** The keyframes made safe for a shot of `length` s: inside the shot, in time order, one per moment, values in range,
 * at most MAX_KEYFRAMES. Returns [keyframes, what changed]. */
export function validate(keyframes: Keyframe[], length: number): [Keyframe[], string[]] {
  const notes: string[] = [];
  const out: Keyframe[] = [];
  const sorted = keyframes.map((k, i) => [k, i] as const).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([k]) => k); // stable, like Python
  for (const k of sorted) {
    const t = Math.min(Math.max(k.t, 0), Math.max(length, 0));
    if (Math.abs(t - k.t) > 1e-6) notes.push(`keyframe at ${fixed(k.t, 3)} s is outside the ${fixed(length, 3)} s shot: moved to ${fixed(t, 3)} s`);
    const values: Partial<Record<KeyframeProp, number>> = {};
    for (const prop of KEYFRAME_PROPS) {
      const v = k[prop];
      if (v === null || v === undefined) continue;
      if (!Number.isFinite(v)) {
        notes.push(`keyframe at ${fixed(t, 3)} s: ${prop} is not a number, left out`);
        continue;
      }
      const [lo, hi] = RANGES[prop];
      const c = Math.min(Math.max(v, lo), hi);
      if (Math.abs(c - v) > 1e-9) notes.push(`keyframe at ${fixed(t, 3)} s: ${prop} ${g(v)} -> ${g(c)} (allowed ${g(lo)}..${g(hi)})`);
      values[prop] = c;
    }
    if (!Object.keys(values).length) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - t) < SAME_TIME) {
      out[out.length - 1] = kf(last.t, { ...setValues(last), ...values }, k.ease);
      continue;
    }
    out.push(kf(round(t, 4), values, k.ease));
  }
  if (out.length > MAX_KEYFRAMES) {
    notes.push(`${out.length} keyframes: only the first ${MAX_KEYFRAMES} are kept`);
    out.length = MAX_KEYFRAMES;
  }
  return [out, notes];
}

/** Per property: [(t, value, ease)] for the keyframes that set it. */
export function tracks(keyframes: Keyframe[]): Partial<Record<KeyframeProp, Track>> {
  const out: Partial<Record<KeyframeProp, Track>> = {};
  for (const k of keyframes) for (const p of KEYFRAME_PROPS) if (k[p] !== null && k[p] !== undefined) (out[p] ??= []).push([k.t, Number(k[p]), k.ease]);
  return out;
}

export const animates = (keyframes: Keyframe[], props: readonly KeyframeProp[]) => keyframes.some((k) => props.some((p) => k[p] !== null && k[p] !== undefined));

export function ease(p: number, e: Ease): number {
  p = Math.min(Math.max(p, 0), 1);
  switch (e) {
    case "linear": return p;
    case "ease_in": return p * p;
    case "ease_out": return p * (2 - p);
    case "ease_in_out": return 0.5 - 0.5 * Math.cos(Math.PI * p);
    case "hold": return p >= 1 ? 1 : 0;
  }
}

export function valueAt(track: Track | undefined, t: number, def = 0): number {
  if (!track?.length) return def;
  let v = track[0][1];
  for (let i = 0; i + 1 < track.length; i++) {
    const [t0, v0] = track[i];
    const [t1, v1, e] = track[i + 1];
    if (t >= t1) v = v1;
    else if (t > t0) return v0 + (v1 - v0) * ease((t - t0) / Math.max(t1 - t0, 1e-6), e);
  }
  return v;
}

// ---------------------------------------------------------------- FFmpeg expressions
const n6 = (v: number) => g(v);

function easeExpr(p: string, e: Ease): string {
  return { linear: p, ease_in: `pow(${p},2)`, ease_out: `(${p})*(2-(${p}))`, ease_in_out: `(0.5-0.5*cos(PI*${p}))`, hold: `gte(${p},1)` }[e];
}

/** A track as one FFmpeg expression of `v`: the first value plus each step's change times its eased progress. */
export function expression(track: Track | undefined, def: number, v = "t"): string {
  if (!track?.length) return n6(def);
  const terms = [n6(track[0][1])];
  for (let i = 0; i + 1 < track.length; i++) {
    const [t0, v0] = track[i];
    const [t1, v1, e] = track[i + 1];
    const dv = v1 - v0;
    if (Math.abs(dv) < 1e-9) continue;
    const p = `clip((${v}-${n6(t0)})/${n6(Math.max(t1 - t0, 1e-4))},0,1)`;
    terms.push(`${n6(dv)}*${easeExpr(p, e)}`);
  }
  return `(${terms.join("+")})`;
}

function rotationCover(maxDeg: number, aspect: number): number {
  const a = (Math.abs(maxDeg) * Math.PI) / 180;
  return Math.cos(a) + Math.max(aspect, 1 / aspect) * Math.sin(a);
}

/** Zoom / position / rotation as filters producing a w x h picture (drawn at twice the size: smooth slow moves). */
export function motionChain(keyframes: Keyframe[], w: number, h: number): string {
  const tr = tracks(keyframes);
  const rot = tr.rotation ?? [];
  const cover = rot.length ? rotationCover(Math.max(0, ...rot.map(([, v]) => Math.abs(v))), w / h) : 1;
  let z = expression(tr.zoom, 1);
  if (cover > 1) z = `max(${z},${n6(cover * 1.004)})`;
  const W2 = 2 * w, H2 = 2 * h;
  const chain = [`scale=w='trunc(${W2}*${z}/2)*2':h='trunc(${H2}*${z}/2)*2':eval=frame:flags=bicubic`];
  const x = expression(tr.x, 0), y = expression(tr.y, 0);
  if (rot.length) {
    const CW = Math.trunc((W2 * cover) / 2) * 2, CH = Math.trunc((H2 * cover) / 2) * 2;
    chain.push(`crop=w=${CW}:h=${CH}:x='(in_w-out_w)/2*(1+(${x}))':y='(in_h-out_h)/2*(1+(${y}))'`);
    chain.push(`rotate=a='(${expression(rot, 0)})*PI/180':fillcolor=black`);
    chain.push(`crop=${W2}:${H2}`);
  } else {
    chain.push(`crop=w=${W2}:h=${H2}:x='(in_w-out_w)/2*(1+(${x}))':y='(in_h-out_h)/2*(1+(${y}))'`);
  }
  chain.push(`scale=${w}:${h}:flags=area`);
  return chain.join(",");
}

/** Opacity, brightness and blur, on the finished w x h picture. */
export function frameFilters(keyframes: Keyframe[], w: number, h: number): string[] {
  const tr = tracks(keyframes);
  const out: string[] = [];
  if (tr.blur) {
    const b = expression(tr.blur, 0);
    out.push(`scale=w='max(trunc(${w}/(1+12.0*${b})/2)*2,16)':h='max(trunc(${h}/(1+12.0*${b})/2)*2,16)':eval=frame:flags=bicubic`);
    out.push(`scale=${w}:${h}:flags=bicubic`);
  }
  if (tr.opacity || tr.brightness) {
    const o = expression(tr.opacity, 1);
    const b = expression(tr.brightness, 0);
    out.push(`eq=contrast='${o}':brightness='0.5*(${o}-1)+${b}':saturation='${o}':eval=frame`);
  }
  return out;
}

/** The keyframes of a fixed effect (the renderer's own numbers), or [] for one that is not a keyframe animation. */
export function preset(effect: string, length: number): Keyframe[] {
  const d = Math.max(length, 0.1);
  switch (effect) {
    case "zoom_in": return [kf(0, { zoom: 1 }), kf(d, { zoom: 1 + ZOOM_AMOUNT })];
    case "zoom_out": return [kf(0, { zoom: 1 + ZOOM_AMOUNT }), kf(d, { zoom: 1 })];
    case "punch": return [kf(0, { zoom: 1 + PUNCH_AMOUNT }), kf(Math.min(PUNCH_SECONDS, d), { zoom: 1 + PUNCH_AMOUNT * Math.max(0, 1 - d / PUNCH_SECONDS) })];
    case "punch_out": {
      const start = Math.max(d - PUNCH_SECONDS, 0);
      return [kf(start, { zoom: 1 + PUNCH_AMOUNT * Math.max(0, 1 - d / PUNCH_SECONDS) }), kf(d, { zoom: 1 + PUNCH_AMOUNT })];
    }
    case "crash_zoom": return [kf(0, { zoom: 1 }), kf(Math.min(CRASH_SECONDS, d), { zoom: 1 + CRASH_AMOUNT * Math.min(d / CRASH_SECONDS, 1) })];
    case "ken_burns": return [kf(0, { zoom: 1, x: -1, y: 1 }), kf(d, { zoom: 1 + KEN_BURNS_AMOUNT, x: 1, y: -1 })];
    case "flash": return [kf(0, { brightness: FLASH_STRENGTH }), kf(Math.min(FLASH_SECONDS, d), { brightness: 0 })];
  }
  const pans: Record<string, ["x" | "y", number, number]> = { pan_right: ["x", -1, 1], pan_left: ["x", 1, -1], pan_down: ["y", -1, 1], pan_up: ["y", 1, -1] };
  if (pans[effect]) {
    const [axis, a, b] = pans[effect];
    return [kf(0, { zoom: PAN_SCALE, [axis]: a }), kf(d, { zoom: PAN_SCALE, [axis]: b }, "ease_in_out")];
  }
  return [];
}

/** `over`'s tracks replace `base`'s for the properties `over` animates; `base` keeps the rest. */
export function merge(base: Keyframe[], over: Keyframe[]): Keyframe[] {
  const taken = new Set(over.flatMap((k) => KEYFRAME_PROPS.filter((p) => k[p] !== null && k[p] !== undefined)));
  const kept: Keyframe[] = [];
  for (const k of base) {
    const values = Object.fromEntries(KEYFRAME_PROPS.filter((p) => k[p] !== null && k[p] !== undefined && !taken.has(p)).map((p) => [p, k[p] as number]));
    if (Object.keys(values).length) kept.push(kf(k.t, values, k.ease));
  }
  return [...kept, ...over].map((k, i) => [k, i] as const).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([k]) => k);
}

// ---------------------------------------------------------------- speed ramps
export const RAMP_STEP = 0.05;
export const hasSpeed = (keyframes: Keyframe[]) => animates(keyframes, ["speed"]);

/** How much footage has played `t` s into the shot: the speed track integrated (midpoint rule, fine steps). */
export function sourceSeconds(keyframes: Keyframe[], t: number, base = 1): number {
  const track = tracks(keyframes).speed;
  if (!track) return base * t;
  const n = Math.max(Math.ceil((t / RAMP_STEP) * 4), 1);
  const dt = t / n;
  return pySum(Array.from({ length: n }, (_, i) => valueAt(track, (i + 0.5) * dt, base))) * dt;
}

export const averageSpeed = (keyframes: Keyframe[], length: number, base = 1) => sourceSeconds(keyframes, length, base) / Math.max(length, 1e-6);

/** The setpts filter that plays the footage at the speed track (the inverse of sourceSeconds, piecewise linear). */
export function speedSetpts(keyframes: Keyframe[], length: number): string {
  const steps = Math.max(Math.ceil(length / RAMP_STEP), 1);
  const shotT = Array.from({ length: steps + 1 }, (_, i) => Math.min(i * RAMP_STEP, length));
  const srcT = shotT.map((t) => sourceSeconds(keyframes, t));
  const s = "(PTS-STARTPTS)*TB";
  const terms = [n6(shotT[0])];
  for (let i = 0; i + 1 < shotT.length; i++) {
    const s0 = srcT[i], s1 = srcT[i + 1], t0 = shotT[i], t1 = shotT[i + 1];
    if (s1 - s0 > 1e-6) terms.push(`${n6(t1 - t0)}*clip((${s}-${n6(s0)})/${n6(s1 - s0)},0,1)`);
  }
  const last = valueAt(tracks(keyframes).speed, length, 1);
  terms.push(`max(${s}-${n6(srcT[srcT.length - 1])},0)/${n6(last)}`);
  return `setpts='(${terms.join("+")})/TB'`;
}

export function slowest(keyframes: Keyframe[]): number {
  const track = tracks(keyframes).speed ?? [[0, 1, "linear"]];
  return Math.min(...track.map(([, v]) => v));
}

/** Ready-made speed ramps timed to the music. */
export function rampPreset(kind: string, length: number, at: number | null = null): Keyframe[] {
  const d = Math.max(length, 0.2);
  const h = Math.min(Math.max(at ?? d / 2, 0.1), d - 0.1);
  switch (kind) {
    case "into_drop": return [kf(0, { speed: 0.6 }), kf(d * 0.6, { speed: 0.6 }), kf(d, { speed: 2 }, "ease_in")];
    case "slow_hit": return [kf(0, { speed: 1 }), kf(Math.max(h - 0.15, 0), { speed: 1 }), kf(h, { speed: 0.35 }, "ease_out"), kf(Math.min(h + 0.6, d), { speed: 1 }, "ease_in_out")];
    case "out_of_drop": return [kf(0, { speed: 2 }), kf(Math.min(0.5, d), { speed: 1 }, "ease_out")];
    case "slow_fast_slow": return [kf(0, { speed: 0.5 }), kf(d / 2, { speed: 2 }, "ease_in_out"), kf(d, { speed: 0.5 }, "ease_in_out")];
  }
  return [];
}
