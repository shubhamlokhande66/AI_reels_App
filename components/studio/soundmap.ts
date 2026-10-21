/** Fast Studio's sound map: what an editor hears in the song, measured on the phone so the AI director can decide with it.
 *
 * The beats and the cut times come from the music engine (engine.ts). This adds, for every moment of the song:
 *  - how loud it is, and whether it is getting louder or quieter
 *  - how much bass, drums and voice / melody there is
 *  - what each sharp hit is: a kick, a dhol or tom, a snare / clap / tabla, or a hi-hat / cymbal
 *  - where the voice comes in, goes up, goes down or stops
 *  - build-ups before a drop and the short silence just before it
 * Everything is plain numbers from one pass of an FFT over the song (no model, nothing uploaded). The AI gets a short
 * text-like summary per cut (describeCut) and per section (sectionsOf); it then decides the pace, transitions, effects
 * and the keyframes on the hits. repace() turns the AI's pace back into cut times on the real beats. */

export interface SoundMap {
  fps: number;
  /** loudness in dB per frame */
  loud: Float32Array;
  /** energy per band: kick / bass (<150 Hz), body: dhol, toms, low voice (150-800 Hz), mid: snare, clap, tabla, voice
   * (0.8-4 kHz), high: hi-hats and cymbals (>4 kHz) */
  lo: Float32Array; body: Float32Array; mid: Float32Array; hi: Float32Array;
  /** sudden rises per band (what makes a hit sound like a kick, a dhol, a snare or a hat) */
  fLo: Float32Array; fBody: Float32Array; fMid: Float32Array; fHi: Float32Array;
  /** 0-1: how much of 250-3500 Hz is a held, pitched sound (a voice or a melody) rather than noise or drums */
  voice: Float32Array;
  /** brightness of that voice band (Hz): rises when the singer goes higher */
  pitch: Float32Array;
  /** percentiles of each band over the whole song, to say "a lot" or "a little" for this song */
  scale: Record<"loud" | "lo" | "body" | "mid" | "hi" | "voice" | "fLo" | "fBody" | "fMid" | "fHi", [number, number]>;
}

export type HitKind = "kick" | "dhol" | "snare" | "hat";
export interface CutMusic {
  /** 0-1, how loud this cut is compared with the rest of the song */
  loud: number;
  trend: "rising" | "falling" | "steady";
  bass: number; drums: number; voice: number;
  /** what the voice does in this cut */
  vox?: "enters" | "stops" | "goes up" | "goes down" | "holds";
  /** the strongest hits inside the cut, seconds from its start */
  hits?: { at: number; k: HitKind; p: 1 | 2 | 3 }[];
  /** beats until the next drop, when one is close (a build-up) */
  toDrop?: number;
  /** the cut ends in a short silence (the gap before a drop) */
  gapEnd?: boolean;
}
export interface Section {
  i: number; t: number; len: number; beats: number;
  /** how the section starts: the song's start, a drop, a break (a sudden quiet part), or a change in the music */
  starts: "start" | "drop" | "break" | "change";
  loud: number; trend: CutMusic["trend"]; bass: number; drums: number; voice: number;
  /** strong hits per second */
  hitRate: number;
  /** the cuts the rules would make here (beats per cut), as a reference for the AI */
  now: number;
}
export interface Slot { start: number; end: number; type: "drop" | "hit" | "cut" | "break"; fx?: string; [k: string]: unknown }

const HOP_SEC = 0.02, N = 2048;

function makeFFT(n: number) {
  const lev = Math.log2(n), rev = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let j = 0; j < lev; j++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half, tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  };
}

const pctl = (a: Float32Array, q: number) => {
  if (!a.length) return 0;
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * q)))];
};

/** One pass over the song (or the part of it in use). About 50 frames a second; a minute of music takes a few
 * hundred milliseconds on a phone. */
export function soundMap(mono: Float32Array, sr: number): SoundMap {
  const hop = Math.max(1, Math.round(sr * HOP_SEC)), frames = Math.max(1, Math.floor(Math.max(0, mono.length - N) / hop) + 1);
  const fft = makeFFT(N), re = new Float64Array(N), im = new Float64Array(N), win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const bin = (hz: number) => Math.max(1, Math.min(N / 2 - 1, Math.round((hz * N) / sr)));
  const k150 = bin(150), k800 = bin(800), k4k = bin(4000), k11k = bin(Math.min(11000, sr / 2 - 1)), kv0 = bin(250), kv1 = bin(3500), kp0 = bin(200), kp1 = bin(2000);
  const mk = () => new Float32Array(frames);
  const loud = mk(), lo = mk(), body = mk(), mid = mk(), hi = mk(), voice = mk(), pitch = mk();
  const fLo = mk(), fBody = mk(), fMid = mk(), fHi = mk();
  const mag = new Float64Array(N / 2);
  let pL = 0, pB = 0, pM = 0, pH = 0;
  for (let f = 0; f < frames; f++) {
    const o = f * hop; let s2 = 0;
    for (let i = 0; i < N; i++) { const v = mono[o + i] || 0; s2 += v * v; re[i] = v * win[i]; im[i] = 0; }
    loud[f] = 10 * Math.log10(s2 / N + 1e-10);
    fft(re, im);
    for (let k = 1; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    let eL = 0, eB = 0, eM = 0, eH = 0;
    for (let k = 1; k < k150; k++) eL += mag[k] * mag[k];
    for (let k = k150; k < k800; k++) eB += mag[k] * mag[k];
    for (let k = k800; k < k4k; k++) eM += mag[k] * mag[k];
    for (let k = k4k; k < k11k; k++) eH += mag[k] * mag[k];
    lo[f] = Math.log1p(eL); body[f] = Math.log1p(eB); mid[f] = Math.log1p(eM); hi[f] = Math.log1p(eH);
    // sudden rises per band (log energy: a hit is a jump, whatever the level)
    if (f) { fLo[f] = Math.max(0, lo[f] - pL); fBody[f] = Math.max(0, body[f] - pB); fMid[f] = Math.max(0, mid[f] - pM); fHi[f] = Math.max(0, hi[f] - pH); }
    pL = lo[f]; pB = body[f]; pM = mid[f]; pH = hi[f];
    // voice / melody: a pitched sound has a few strong peaks (low spectral flatness) in 250-3500 Hz
    let lg = 0, ar = 0, n = 0, ev = 0;
    const et = eL + eB + eM + eH + 1e-12;
    for (let k = kv0; k < kv1; k++) { const m = mag[k] + 1e-9; lg += Math.log(m); ar += m; n++; ev += m * m; }
    const flat = n ? Math.exp(lg / n) / (ar / n) : 1;
    voice[f] = Math.max(0, Math.min(1, (1 - flat) * Math.min(1, (2 * ev) / et)));
    let cw = 0, cs = 0;
    for (let k = kp0; k < kp1; k++) { const w = mag[k] * mag[k]; cw += w; cs += w * k; }
    pitch[f] = cw > 0 ? ((cs / cw) * sr) / N : 0;
  }
  const sc = (a: Float32Array): [number, number] => [pctl(a, 0.1), Math.max(pctl(a, 0.1) + 1e-6, pctl(a, 0.95))];
  return {
    fps: 1 / (hop / sr), loud, lo, body, mid, hi, fLo, fBody, fMid, fHi, voice, pitch,
    scale: { loud: sc(loud), lo: sc(lo), body: sc(body), mid: sc(mid), hi: sc(hi), voice: sc(voice), fLo: sc(fLo), fBody: sc(fBody), fMid: sc(fMid), fHi: sc(fHi) },
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const frameOf = (m: SoundMap, t: number) => Math.max(0, Math.min(m.loud.length - 1, Math.round(t * m.fps)));
function meanOf(m: SoundMap, a: Float32Array, t0: number, t1: number) {
  const f0 = frameOf(m, t0), f1 = Math.max(f0 + 1, Math.min(a.length, Math.round(t1 * m.fps)));
  let s = 0; for (let f = f0; f < f1; f++) s += a[f];
  return s / Math.max(1, f1 - f0);
}
/** a band's level in [t0, t1] for this song: 0 = as little as its quietest parts, 1 = as much as its fullest */
function level(m: SoundMap, key: keyof SoundMap["scale"], t0: number, t1: number) {
  const [a, b] = m.scale[key];
  return clamp01((meanOf(m, m[key] as Float32Array, t0, t1) - a) / (b - a));
}
function trendOf(m: SoundMap, t0: number, t1: number): CutMusic["trend"] {
  const L = t1 - t0; if (L < 0.4) return "steady";
  const d = meanOf(m, m.loud, t1 - L / 3, t1) - meanOf(m, m.loud, t0, t0 + L / 3);
  return d > 2 ? "rising" : d < -2 ? "falling" : "steady";
}

/** What a hit at time t sounds like: the band that jumped the most for its usual size. */
export function hitKind(m: SoundMap, t: number): HitKind {
  const f = frameOf(m, t);
  const peak = (a: Float32Array) => { let v = 0; for (let j = Math.max(0, f - 2); j <= Math.min(a.length - 1, f + 2); j++) v = Math.max(v, a[j]); return v; };
  const z = (a: Float32Array, k: keyof SoundMap["scale"]) => peak(a) / Math.max(1e-6, m.scale[k][1]);
  const c: [HitKind, number][] = [["kick", z(m.fLo, "fLo")], ["dhol", z(m.fBody, "fBody") * 0.95], ["snare", z(m.fMid, "fMid")], ["hat", z(m.fHi, "fHi") * 0.8]];
  return c.sort((x, y) => y[1] - x[1])[0][0];
}

export interface CutContext {
  /** the strong hits of the song (seconds) and how strong each is (engine: hitsRaw, hitsStr) */
  hits: number[]; hitStr: number[];
  /** the song's drops (seconds) and beats, for "beats until the drop" */
  drops: number[]; beats: number[];
}

/** The music of one cut [t0, t1], as the AI director reads it. */
export function describeCut(m: SoundMap, t0: number, t1: number, cx: CutContext): CutMusic {
  const out: CutMusic = {
    loud: r2(level(m, "loud", t0, t1)), trend: trendOf(m, t0, t1),
    bass: r2(level(m, "lo", t0, t1)),
    drums: r2(Math.max(level(m, "fBody", t0, t1), level(m, "fMid", t0, t1), level(m, "fLo", t0, t1))),
    voice: r2(level(m, "voice", t0, t1)),
  };
  // the voice: does it come in, stop, go higher or lower in this cut?
  const vb = level(m, "voice", Math.max(0, t0 - 0.6), t0), vn = out.voice;
  if (vb < 0.25 && vn > 0.45) out.vox = "enters";
  else if (vb > 0.45 && vn < 0.2) out.vox = "stops";
  else if (vn > 0.35 && t1 - t0 > 0.5) {
    const h = (t0 + t1) / 2, p0 = meanOf(m, m.pitch, t0, h), p1 = meanOf(m, m.pitch, h, t1);
    out.vox = p0 > 0 && p1 / p0 > 1.12 ? "goes up" : p0 > 0 && p1 / p0 < 0.89 ? "goes down" : "holds";
  }
  // the strongest hits inside, with what they sound like
  const inside: { t: number; s: number }[] = [];
  cx.hits.forEach((t, k) => { if (t > t0 + 0.04 && t < t1 - 0.04) inside.push({ t, s: cx.hitStr[k] || 1 }); });
  if (inside.length) {
    const ss = cx.hitStr.slice().sort((a, b) => a - b), q1 = ss[Math.floor(ss.length / 3)] ?? 1, q2 = ss[Math.floor((2 * ss.length) / 3)] ?? 1;
    out.hits = inside.sort((a, b) => b.s - a.s).slice(0, 4).sort((a, b) => a.t - b.t)
      .map((h) => ({ at: r2(h.t - t0), k: hitKind(m, h.t), p: (h.s >= q2 ? 3 : h.s >= q1 ? 2 : 1) as 1 | 2 | 3 }));
  }
  // a build-up: the next drop is close
  const nd = cx.drops.find((d) => d >= t1 - 0.05);
  if (nd !== undefined) { const n = cx.beats.filter((b) => b >= t1 - 0.05 && b < nd - 0.05).length; if (n <= 8) out.toDrop = n; }
  // the gap before a drop: the end of the cut is much quieter than the cut
  if (t1 - t0 > 0.35 && meanOf(m, m.loud, t1 - 0.2, t1) < meanOf(m, m.loud, t0, t1 - 0.2) - 9) out.gapEnd = true;
  return out;
}

/** The song in sections, for the AI to choose the pace of each: a new section at every drop and break, long ones split
 * (at most 32 beats), short ones joined to the one before (at least 4 beats). */
export function sectionsOf(m: SoundMap, plan: Slot[], beats: number[], period: number, dur: number): Section[] {
  if (!plan.length) return [];
  const minLen = Math.max(1.2, 4 * period), maxLen = Math.max(8, 32 * period);
  let bounds: { t: number; starts: Section["starts"] }[] = [{ t: 0, starts: "start" }];
  for (const s of plan) if ((s.type === "drop" || s.type === "break") && s.start > 0.05) bounds.push({ t: s.start, starts: s.type });
  // a change in the music without a drop (a verse into a chorus): loudness moves by a lot for several seconds
  const W = Math.max(2, 8 * period);
  for (let t = W; t < dur - W; t += Math.max(0.5, period)) {
    const d = meanOf(m, m.loud, t, t + W) - meanOf(m, m.loud, t - W, t);
    if (Math.abs(d) > 5 && bounds.every((b) => Math.abs(b.t - t) > W)) {
      const s = plan.reduce((best, x) => (Math.abs(x.start - t) < Math.abs(best.start - t) ? x : best), plan[0]);
      if (bounds.every((b) => Math.abs(b.t - s.start) > minLen)) bounds.push({ t: s.start, starts: "change" });
    }
  }
  bounds.sort((a, b) => a.t - b.t);
  bounds = bounds.filter((b, k) => k === 0 || b.t - bounds[k - 1].t >= minLen * 0.5);
  // joined / split
  const merged: typeof bounds = [];
  bounds.forEach((b, k) => { const end = k + 1 < bounds.length ? bounds[k + 1].t : dur; if (merged.length && end - b.t < minLen && b.starts !== "drop") return; merged.push(b); });
  const parts: { t: number; end: number; starts: Section["starts"] }[] = [];
  merged.forEach((b, k) => {
    const end = k + 1 < merged.length ? merged[k + 1].t : dur, n = Math.ceil((end - b.t) / maxLen);
    for (let j = 0; j < n; j++) {
      let a = b.t + ((end - b.t) * j) / n;
      if (j) { const nb = beats.reduce((best, x) => (Math.abs(x - a) < Math.abs(best - a) ? x : best), a); a = nb - 1 / 30; }
      parts.push({ t: a, end: 0, starts: j ? "change" : b.starts });
    }
  });
  parts.forEach((p, k) => { p.end = k + 1 < parts.length ? parts[k + 1].t : dur; });
  return parts.filter((p) => p.end - p.t > 0.1).map((p, i) => {
    const nb = beats.filter((b) => b >= p.t - 0.05 && b < p.end - 0.05).length;
    const cutsIn = plan.filter((s) => s.start >= p.t - 0.02 && s.start < p.end - 0.02).length;
    const hitsIn = plan.filter((s) => s.type === "hit" && s.start >= p.t && s.start < p.end).length;
    return {
      i, t: r2(p.t), len: r2(p.end - p.t), beats: nb, starts: p.starts,
      loud: r2(level(m, "loud", p.t, p.end)), trend: trendOf(m, p.t, p.end), bass: r2(level(m, "lo", p.t, p.end)),
      drums: r2(Math.max(level(m, "fBody", p.t, p.end), level(m, "fMid", p.t, p.end), level(m, "fLo", p.t, p.end))),
      voice: r2(level(m, "voice", p.t, p.end)), hitRate: r2(hitsIn / Math.max(0.5, p.end - p.t)),
      now: Math.max(1, Math.round(nb / Math.max(1, cutsIn))),
    };
  });
}

/** Beats per cut each style may use (Smooth stays calm, Fast stays quick, whatever the AI says). */
export const PACE_OK: Record<string, number[]> = { auto: [1, 2, 4, 8], smooth: [2, 4, 8], fast: [1, 2] };

/** The AI's pace back into cut times: inside each section a cut every `every` beats, on the real beats (one frame early,
 * like the music engine). Drops and breaks always stay cuts; the song's strong hits stay when the pace is quick
 * (1-2 beats). No shot runs longer than 4.5 s. */
export function repace(plan: Slot[], secs: { t: number; len: number; every: number }[], beats: number[], dur: number, mode = "auto"): Slot[] {
  if (!plan.length || !secs.length || beats.length < 8) return plan.map((s) => ({ ...s }));
  const ok = PACE_OK[mode] || PACE_OK.auto, EARLY = 1 / 30, MIN = 0.25;
  const at = new Map<string, Slot>(); plan.forEach((s) => at.set(s.start.toFixed(3), s));
  const typeAt = (t: number) => plan.find((s) => Math.abs(s.start - t) < 0.02);
  const cuts: { t: number; type: Slot["type"]; fx?: string; keep: boolean }[] = [];
  plan.forEach((s) => { if (s.type === "drop" || s.type === "break" || s.start < 0.01) cuts.push({ t: s.start, type: s.start < 0.01 && s.type !== "drop" ? "cut" : s.type, fx: s.fx, keep: true }); });
  for (const sec of secs) {
    const every = ok.reduce((b, x) => (Math.abs(x - sec.every) < Math.abs(b - sec.every) ? x : b), ok[0]);
    const a = sec.t, b = Math.min(dur, sec.t + sec.len);
    const bs = beats.filter((x) => x >= a - 0.05 && x < b - 0.05);
    for (let k = every; k < bs.length; k += every) { const t = bs[k] - EARLY; if (t < b - MIN && t > a + MIN) cuts.push({ t, type: "cut", keep: false }); }
    if (every <= 2) plan.forEach((s) => { if (s.type === "hit" && s.start > a + MIN && s.start < b - MIN) cuts.push({ t: s.start, type: "hit", fx: s.fx, keep: false }); });
  }
  cuts.sort((x, y) => x.t - y.t || Number(y.keep) - Number(x.keep));
  const out: typeof cuts = [];
  for (const c of cuts) {
    const last = out[out.length - 1];
    if (last && c.t - last.t < MIN) {
      if (c.keep && !last.keep) out[out.length - 1] = c;
      else if (!c.keep && !last.keep && c.type === "hit" && last.type === "cut") out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  // no shot longer than 4.5 s: split on the beat nearest the middle
  const res: Slot[] = [];
  out.forEach((c, k) => {
    const end = k + 1 < out.length ? out[k + 1].t : dur;
    const base = typeAt(c.t) || at.get(c.t.toFixed(3));
    let s = c.t;
    while (end - s > 4.5) {
      const mid = s + Math.min(3, (end - s) / 2);
      const bt = (beats.filter((x) => x > s + 1.2 && x < end - 1).reduce<number | null>((best, x) => (best === null || Math.abs(x - mid) < Math.abs(best - mid) ? x : best), null) ?? mid) - EARLY;
      res.push({ start: s, end: bt, type: s === c.t ? c.type : "cut", fx: s === c.t ? (base?.fx ?? c.fx ?? "Hard cut") : "Hard cut" }); s = bt;
    }
    if (end - s >= 0.08) res.push({ start: s, end, type: s === c.t ? c.type : "cut", fx: s === c.t ? (base?.fx ?? c.fx ?? "Hard cut") : "Hard cut" });
  });
  if (res.length) res[0].start = 0;
  return res;
}
