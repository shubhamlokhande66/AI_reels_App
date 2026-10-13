import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { moveFile } from "@/server/storage/local";
import path from "node:path";
import { FFmpegError } from "@/server/core/errors";
import { findBinary } from "@/server/core/ffmpeg";
import { PyRandom } from "@/server/core/random";
import { opencv, type CV, type Mat } from "@/server/video/cv";
import { assFilter } from "@/server/video/render/text";
import { cleanText, type ProductReelPlan, type ProductStyle, type Shot, type TextLayer, type View } from "./director";
import { loadBgr, matOf } from "./understand";

/** Render a product Reel plan (were product/render.py, effects.py, textass.py): the camera is a 9:16 window over the
 * original photo - every frame is one affine transform of its pixels (crop, uniform scale, a degree of roll), so the
 * product is never redrawn or stretched; light, sparkle, glow and transitions are added on top. */

export interface RenderSettings { width: number; height: number; fps: number; crf: number; preset: string; musicVolume: number }
export const FINAL: RenderSettings = { width: 1080, height: 1920, fps: 30, crf: 18, preset: "medium", musicVolume: 1 };
export const PREVIEW: RenderSettings = { width: 540, height: 960, fps: 24, crf: 27, preset: "ultrafast", musicVolume: 1 };
const MAX_WORLD_SIDE = 4096, WARM = [0.72, 0.9, 1.0], GOLD = [0.3, 0.62, 1.0];

export function ease(p: number, kind = "in_out") {
  p = Math.min(Math.max(p, 0), 1);
  if (kind === "linear") return p;
  if (kind === "out") return 1 - (1 - p) ** 2;
  if (kind === "in") return p * p;
  return p * p * (3 - 2 * p);
}
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

// ------------------------------------------------------------------ effects (frames are CV_8UC3 BGR Mats; each returns a new Mat and deletes nothing it was given)
class Fx {
  lw: number; lh: number; radial: Float32Array; sprites = new Map<number, Float32Array>(); vignettes = new Map<number, Mat>(); dustDots: { px: number; py: number; vx: number; vy: number; rad: number; val: number }[];
  constructor(private cv: CV, public w: number, public h: number) {
    this.lw = Math.max(Math.trunc(w / 4), 8); this.lh = Math.max(Math.trunc(h / 4), 8);
    this.radial = new Float32Array(this.lw * this.lh);
    for (let y = 0; y < this.lh; y++) for (let x = 0; x < this.lw; x++) { const dx = (x / this.lw - 0.5) / 0.5, dy = (y / this.lh - 0.5) / 0.5; this.radial[y * this.lw + x] = clamp01(Math.sqrt(dx * dx + dy * dy) / Math.SQRT2); }
    const rng = new PyRandom(7);
    this.dustDots = Array.from({ length: 26 }, () => ({ px: rng.random(), py: rng.random(), vx: rng.uniform(-0.02, 0.02), vy: rng.uniform(-0.05, -0.01), rad: (rng.uniform(1.2, 3.4) * w) / 1080, val: Math.trunc(120 + 135 * rng.random()) }));
  }
  dispose() { for (const m of this.vignettes.values()) m.delete(); }
  /** A low-resolution float light layer (lh x lw x 3), screen-blended over the frame. */
  private screen(frame: Mat, layer: Float32Array): Mat {
    const cv = this.cv, lm = new cv.Mat(this.lh, this.lw, cv.CV_32FC3), up = new cv.Mat();
    lm.data32F.set(layer);
    cv.resize(lm, up, new cv.Size(this.w, this.h), 0, 0, cv.INTER_LINEAR);
    const out = frame.clone(), o = out.data as Uint8Array, f = frame.data as Uint8Array, l = up.data32F as Float32Array;
    for (let i = 0; i < o.length; i++) { const v = f[i] / 255; o[i] = Math.min(Math.max((1 - (1 - v) * (1 - clamp01(l[i]))) * 255, 0), 255); }
    lm.delete(); up.delete();
    return out;
  }
  private lowGray(frame: Mat): Float32Array {
    const cv = this.cv, s = new cv.Mat(), g = new cv.Mat();
    cv.resize(frame, s, new cv.Size(this.lw, this.lh), 0, 0, cv.INTER_AREA); cv.cvtColor(s, g, cv.COLOR_BGR2GRAY);
    const out = Float32Array.from(g.data as Uint8Array, (v) => v / 255);
    s.delete(); g.delete();
    return out;
  }
  vignette(frame: Mat, strength: number): Mat {
    const cv = this.cv;
    if (strength <= 0) return frame.clone();
    const key = Math.round(strength * 1e4) / 1e4;
    let m8 = this.vignettes.get(key);
    if (!m8) {
      const small = new cv.Mat(this.lh, this.lw, cv.CV_32FC1), up = new cv.Mat();
      for (let i = 0; i < this.radial.length; i++) small.data32F[i] = 1 - strength * this.radial[i] ** 2.2;
      cv.resize(small, up, new cv.Size(this.w, this.h), 0, 0, cv.INTER_LINEAR);
      m8 = new cv.Mat(this.h, this.w, cv.CV_8UC3);
      const d = up.data32F as Float32Array;
      for (let i = 0; i < d.length; i++) { const v = Math.min(Math.max(Math.round(d[i] * 255), 0), 255); m8.data[i * 3] = v; m8.data[i * 3 + 1] = v; m8.data[i * 3 + 2] = v; }
      small.delete(); up.delete();
      this.vignettes.set(key, m8);
    }
    const out = new cv.Mat();
    cv.multiply(frame, m8, out, 1 / 255);
    return out;
  }
  grade(frame: Mat, contrast: number): Mat {
    const out = frame.clone();
    if (Math.abs(contrast - 1) < 1e-3) return out;
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.min(Math.max(Math.trunc((i - 128) * contrast + 128), 0), 255);
    const o = out.data as Uint8Array;
    for (let i = 0; i < o.length; i++) o[i] = lut[o[i]];
    return out;
  }
  lightSweep(frame: Mat, p: number, strength = 0.55, angleDeg = 24, width = 0.11): Mat {
    const th = (angleDeg * Math.PI) / 180, pos = -0.25 + 1.9 * ease(p), lum = this.lowGray(frame), fade = Math.sin(Math.PI * clamp01(p)) ** 0.6, layer = new Float32Array(this.lw * this.lh * 3);
    for (let y = 0; y < this.lh; y++) for (let x = 0; x < this.lw; x++) {
      const i = y * this.lw + x, u = (x / this.lw) * Math.cos(th) + (y / this.lh) * Math.sin(th), v = Math.exp(-(((u - pos) / width) ** 2)) * (0.22 + 1.1 * lum[i] ** 2) * strength * fade;
      for (let c = 0; c < 3; c++) layer[i * 3 + c] = v * WARM[c];
    }
    return this.screen(frame, layer);
  }
  glow(frame: Mat, strength = 0.3, threshold = 0.72): Mat {
    const cv = this.cv, s = new cv.Mat(), f = new cv.Mat(this.lh, this.lw, cv.CV_32FC3), b = new cv.Mat();
    cv.resize(frame, s, new cv.Size(this.lw, this.lh), 0, 0, cv.INTER_AREA);
    for (let i = 0; i < s.data.length; i++) f.data32F[i] = Math.min(Math.max(s.data[i] / 255 - threshold, 0), 1) / (1 - threshold);
    cv.GaussianBlur(f, b, new cv.Size(0, 0), Math.max(this.lw / 45, 2));
    const layer = Float32Array.from(b.data32F as Float32Array, (v) => v * strength);
    s.delete(); f.delete(); b.delete();
    return this.screen(frame, layer);
  }
  lightLeak(frame: Mat, p: number, strength = 0.4): Mat {
    const cx = 1.05 - 0.25 * p, cy = 0.05 + 0.18 * p, env = strength * Math.sin(Math.PI * clamp01(p)), layer = new Float32Array(this.lw * this.lh * 3);
    for (let y = 0; y < this.lh; y++) for (let x = 0; x < this.lw; x++) {
      const d = Math.sqrt((x / this.lw - cx) ** 2 + ((y / this.lh - cy) * 1.4) ** 2), v = Math.exp(-((d / 0.5) ** 2)) * env, i = (y * this.lw + x) * 3;
      for (let c = 0; c < 3; c++) layer[i + c] = v * GOLD[c];
    }
    return this.screen(frame, layer);
  }
  private sprite(size: number): Float32Array {
    size = Math.max(size | 1, 9);
    let s = this.sprites.get(size);
    if (!s) {
      s = new Float32Array(size * size);
      const c = Math.trunc(size / 2);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = x - c, dy = y - c, rr = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        const core = Math.exp(-((rr / (size * 0.06)) ** 2)), glow = Math.exp(-((rr / (size * 0.16)) ** 2)) * 0.55;
        const horiz = Math.exp(-((Math.abs(dy) / (size * 0.018)) ** 2)) * Math.exp(-((Math.abs(dx) / (size * 0.5)) ** 1.6)), vert = Math.exp(-((Math.abs(dx) / (size * 0.018)) ** 2)) * Math.exp(-((Math.abs(dy) / (size * 0.5)) ** 1.6));
        s[y * size + x] = clamp01(core + glow + 0.9 * horiz + 0.9 * vert);
      }
      this.sprites.set(size, s);
    }
    return s;
  }
  sparkle(frame: Mat, x: number, y: number, p: number, strength = 0.9, sizeFrac = 0.16): Mat {
    const out = frame.clone(), env = Math.sin(Math.PI * clamp01(p)) ** 1.4;
    if (env < 0.02) return out;
    const size = Math.max(Math.trunc(this.w * sizeFrac * (0.55 + 0.7 * env)) | 1, 9), spr = this.sprite(size), cx = Math.trunc(x * this.w), cy = Math.trunc(y * this.h);
    const x0 = cx - Math.trunc(size / 2), y0 = cy - Math.trunc(size / 2), tint = [0.92, 0.97, 1.0], o = out.data as Uint8Array;
    for (let yy = Math.max(y0, 0); yy < Math.min(y0 + size, this.h); yy++) for (let xx = Math.max(x0, 0); xx < Math.min(x0 + size, this.w); xx++) {
      const a = spr[(yy - y0) * size + (xx - x0)] * 255 * strength * env, i = (yy * this.w + xx) * 3;
      for (let c = 0; c < 3; c++) o[i + c] = Math.min(Math.max(o[i + c] + a * tint[c], 0), 255);
    }
    return out;
  }
  dust(frame: Mat, t: number, strength = 0.35): Mat {
    const cv = this.cv, layer = cv.Mat.zeros(this.h, this.w, cv.CV_8UC1), blurred = new cv.Mat();
    for (const d of this.dustDots) {
      const x = (((d.px + d.vx * t) % 1) + 1) % 1, y = (((d.py + d.vy * t) % 1) + 1) % 1;
      cv.circle(layer, new cv.Point(Math.trunc(x * this.w), Math.trunc(y * this.h)), Math.max(Math.trunc(d.rad), 1), new cv.Scalar(d.val), -1, cv.LINE_AA);
    }
    cv.GaussianBlur(layer, blurred, new cv.Size(0, 0), 1.1);
    const out = frame.clone(), o = out.data as Uint8Array, l = blurred.data as Uint8Array;
    for (let i = 0; i < l.length; i++) { const a = Math.trunc(l[i] * strength); if (a) for (let c = 0; c < 3; c++) o[i * 3 + c] = Math.min(o[i * 3 + c] + a, 255); }
    layer.delete(); blurred.delete();
    return out;
  }
  flash(frame: Mat, amount: number): Mat {
    const out = new this.cv.Mat();
    amount = clamp01(amount);
    if (amount > 0) this.cv.convertScaleAbs(frame, out, 1 - amount, 255 * amount); else frame.copyTo(out);
    return out;
  }
  darken(frame: Mat, amount: number): Mat {
    const out = new this.cv.Mat();
    amount = clamp01(amount);
    if (amount > 0) this.cv.convertScaleAbs(frame, out, 1 - amount, 0); else frame.copyTo(out);
    return out;
  }
  blur(frame: Mat, radius: number): Mat {
    const cv = this.cv;
    if (radius < 0.6) return frame.clone();
    const h = frame.rows, w = frame.cols, k = radius > 6 ? 0.5 : 1, out = new cv.Mat();
    if (k < 1) {
      const s = new cv.Mat(), b = new cv.Mat();
      cv.resize(frame, s, new cv.Size(Math.max(Math.trunc(w * k), 8), Math.max(Math.trunc(h * k), 8)), 0, 0, cv.INTER_AREA);
      cv.GaussianBlur(s, b, new cv.Size(0, 0), radius * k);
      cv.resize(b, out, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
      s.delete(); b.delete();
    } else cv.GaussianBlur(frame, out, new cv.Size(0, 0), radius);
    return out;
  }
  zoom(frame: Mat, factor: number): Mat {
    const cv = this.cv;
    if (Math.abs(factor - 1) < 1e-3) return frame.clone();
    const m = cv.getRotationMatrix2D(new cv.Point(frame.cols / 2, frame.rows / 2), 0, factor), out = new cv.Mat();
    cv.warpAffine(frame, out, m, new cv.Size(frame.cols, frame.rows), cv.INTER_LINEAR, cv.BORDER_REFLECT_101);
    m.delete();
    return out;
  }
  whip(frame: Mat, shift: number, direction: number): Mat {
    const cv = this.cv, w = frame.cols, h = frame.rows, m = cv.matFromArray(2, 3, cv.CV_64F, [1, 0, shift * w * direction, 0, 1, 0]), moved = new cv.Mat();
    cv.warpAffine(frame, moved, m, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REFLECT_101);
    m.delete();
    const k = Math.trunc(Math.min(Math.abs(shift) * w * 0.35, 90)) | 1;
    if (k < 3) return moved;
    const out = new cv.Mat();
    cv.blur(moved, out, new cv.Size(k, 1), new cv.Point(-1, -1), cv.BORDER_REFLECT_101);
    moved.delete();
    return out;
  }
}

// ------------------------------------------------------------------ the camera over one photo
class World {
  levels: Mat[]; w: number; h: number; backdrop: Mat; mask: Mat; bw: number; bh: number;
  constructor(private cv: CV, img: Mat) {
    let src = img;
    if (Math.max(img.rows, img.cols) > MAX_WORLD_SIDE) {
      const k = MAX_WORLD_SIDE / Math.max(img.rows, img.cols);
      src = new cv.Mat();
      cv.resize(img, src, new cv.Size(Math.trunc(img.cols * k), Math.trunc(img.rows * k)), 0, 0, cv.INTER_AREA);
      img.delete();
    }
    this.levels = [src]; this.h = src.rows; this.w = src.cols;
    this.bw = 256; this.bh = Math.max(Math.trunc((256 * this.h) / this.w), 8);
    const small = new cv.Mat(), soft = new cv.Mat();
    cv.resize(src, small, new cv.Size(this.bw, this.bh), 0, 0, cv.INTER_AREA);
    cv.GaussianBlur(small, soft, new cv.Size(0, 0), 6);
    this.backdrop = new cv.Mat();
    cv.convertScaleAbs(soft, this.backdrop, 0.5, 0); // dimmed, so the product stays the brightest thing
    this.mask = new cv.Mat(this.bh, this.bw, cv.CV_8UC1, new cv.Scalar(255));
    small.delete(); soft.delete();
  }
  level(n: number): Mat {
    while (this.levels.length <= n) {
      const prev = this.levels[this.levels.length - 1], next = new this.cv.Mat();
      this.cv.resize(prev, next, new this.cv.Size(Math.max(Math.trunc(prev.cols / 2), 1), Math.max(Math.trunc(prev.rows / 2), 1)), 0, 0, this.cv.INTER_AREA);
      this.levels.push(next);
    }
    return this.levels[n];
  }
  dispose() { for (const m of [...this.levels, this.backdrop, this.mask]) m.delete(); }
}
function matrix(v: View, iw: number, ih: number, w: number, h: number): number[] {
  const s = h / (v.hh * ih), th = (v.roll * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th), cx = v.cx * iw, cy = v.cy * ih;
  return [s * c, s * sn, w / 2 - s * (c * cx + sn * cy), -s * sn, s * c, h / 2 - s * (-sn * cx + c * cy)];
}
const mix = (a: View, b: View, p: number): View => ({ cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p, hh: a.hh * (b.hh / a.hh) ** p, roll: a.roll + (b.roll - a.roll) * p });
function compose(cv: CV, world: World, view: View, w: number, h: number): Mat {
  const m = matrix(view, world.w, world.h, w, h), s = Math.hypot(m[0], m[1]), lvl = s < 1 ? Math.max(Math.floor(Math.log2(1 / s)), 0) : 0, k = 1 / 2 ** lvl;
  const ml = cv.matFromArray(2, 3, cv.CV_64F, [m[0] / k, m[1] / k, m[2], m[3] / k, m[4] / k, m[5]]);
  // the photo corners the frame sees: inside the photo = no backdrop needed
  const det = m[0] * m[4] - m[1] * m[3], inv = (x: number, y: number) => { const dx = x - m[2], dy = y - m[5]; return [(m[4] * dx - m[1] * dy) / det, (-m[3] * dx + m[0] * dy) / det]; };
  const inside = [[0, 0], [w, 0], [0, h], [w, h]].every(([x, y]) => { const [px, py] = inv(x, y); return px >= 0 && px <= world.w && py >= 0 && py <= world.h; });
  const fg = new cv.Mat();
  cv.warpAffine(world.level(lvl), fg, ml, new cv.Size(w, h), s > 1 ? cv.INTER_CUBIC : cv.INTER_LINEAR, inside ? cv.BORDER_REFLECT_101 : cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
  ml.delete();
  if (inside) return fg;
  const kb = world.bw / world.w, mb = cv.matFromArray(2, 3, cv.CV_64F, [m[0] / kb, m[1] / kb, m[2], m[3] / kb, m[4] / kb, m[5]]), bg = new cv.Mat(), alpha = new cv.Mat();
  cv.warpAffine(world.backdrop, bg, mb, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REFLECT_101);
  cv.warpAffine(world.mask, alpha, mb, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
  const o = fg.data as Uint8Array, b = bg.data as Uint8Array, a = alpha.data as Uint8Array;
  for (let i = 0; i < a.length; i++) { const t = a[i] / 255; for (let c = 0; c < 3; c++) { const j = i * 3 + c; o[j] = Math.min(Math.max(b[j] * (1 - t) + o[j] * t, 0), 255); } }
  mb.delete(); bg.delete(); alpha.delete();
  return fg;
}

class FrameMaker {
  fx: Fx; starts: number[];
  constructor(private cv: CV, private plan: ProductReelPlan, private worlds: World[], private style: ProductStyle, private rs: RenderSettings) {
    this.fx = new Fx(cv, rs.width, rs.height);
    this.starts = plan.shots.map((s) => s.start);
  }
  private shotAt(t: number): Shot {
    let i = 0;
    while (i + 1 < this.starts.length && this.starts[i + 1] <= t) i++;
    return this.plan.shots[i];
  }
  private view(shot: Shot, t: number) { const c = shot.camera; return mix(c.start, c.end, ease((t - shot.start) / Math.max(shot.end - shot.start, 1e-6), c.ease)); }
  private base(shot: Shot, t: number): Mat { return compose(this.cv, this.worlds[shot.imageIndex], this.view(shot, t), this.rs.width, this.rs.height); }
  private transition(frame: Mat, kind: string, p: number, side: "in" | "out"): Mat {
    const e = ease(side === "out" ? p : 1 - p, "in"), sc = this.rs.width / 1080, fx = this.fx;
    if (kind === "blur") return fx.blur(frame, 16 * e * sc);
    if (kind === "light") { const b = fx.blur(frame, 4 * e), o = fx.flash(b, 0.45 * e); b.delete(); return o; }
    if (kind === "flash") return fx.flash(frame, 0.9 * e);
    if (kind === "zoom") { const z = fx.zoom(frame, 1 + 0.32 * e), o = fx.blur(z, 8 * e * sc); z.delete(); return o; }
    if (kind === "whip_left" || kind === "whip_right") { const d = kind === "whip_left" ? -1 : 1; return fx.whip(frame, 0.55 * e, side === "out" ? d : -d); }
    if (kind === "dip_to_black") return fx.darken(frame, e);
    return frame.clone();
  }
  frame(t: number): Mat {
    const cv = this.cv, shot = this.shotAt(t), idx = shot.index, local = t - shot.start, shots = this.plan.shots;
    let img = this.base(shot, t);
    const step = (next: Mat) => { img.delete(); img = next; };
    for (const e of shot.effects) {
      if (!(e.at - 1e-6 <= local && local <= e.at + e.duration + 1e-6)) continue;
      const p = (local - e.at) / Math.max(e.duration, 1e-6);
      if (e.type === "light_sweep") step(this.fx.lightSweep(img, p, e.strength));
      else if (e.type === "glow") step(this.fx.glow(img, e.strength));
      else if (e.type === "light_leak") step(this.fx.lightLeak(img, p, e.strength));
      else if (e.type === "dust") step(this.fx.dust(img, t, e.strength));
      else if (e.type === "flash") step(this.fx.flash(img, e.strength * (1 - p)));
      else if (e.type === "sparkle" && e.x !== null && e.y !== null) {
        const w = this.worlds[shot.imageIndex], m = matrix(this.view(shot, t), w.w, w.h, this.rs.width, this.rs.height);
        const fxp = m[0] * e.x * w.w + m[1] * e.y * w.h + m[2], fyp = m[3] * e.x * w.w + m[4] * e.y * w.h + m[5];
        step(this.fx.sparkle(img, fxp / this.rs.width, fyp / this.rs.height, p, e.strength));
      }
    }
    const tin = shot.transitionIn;
    if (idx > 0 && !["cut", "match", "fade_from_black"].includes(tin.type)) { const half = tin.duration / 2; if (half > 0 && local < half) step(this.transition(img, tin.type, local / half, "in")); }
    if (idx + 1 < shots.length) {
      const nxt = shots[idx + 1].transitionIn;
      if (!["cut", "match", "fade_from_black"].includes(nxt.type) && nxt.duration > 0) { const half = nxt.duration / 2, left = shot.end - t; if (left < half) step(this.transition(img, nxt.type, 1 - left / half, "out")); }
    }
    const blend = (other: Mat, w: number) => { const out = new cv.Mat(); cv.addWeighted(img, w, other, 1 - w, 0, out); other.delete(); step(out); };
    if (idx > 0 && tin.type === "dissolve" && tin.duration > 0 && local < tin.duration / 2) { const prev = shots[idx - 1]; blend(this.base(prev, prev.end), 0.5 + (0.5 * local) / (tin.duration / 2)); }
    if (idx + 1 < shots.length) { const ns = shots[idx + 1], nt = ns.transitionIn; if (nt.type === "dissolve" && nt.duration > 0 && shot.end - t < nt.duration / 2) blend(this.base(ns, ns.start), 0.5 + (0.5 * (shot.end - t)) / (nt.duration / 2)); }
    if (idx === 0 && tin.type === "fade_from_black" && tin.duration > 0) step(this.fx.darken(img, 1 - ease(local / tin.duration, "out")));
    step(this.fx.grade(img, this.style.contrast));
    step(this.fx.vignette(img, this.style.vignette));
    return img;
  }
}

// ------------------------------------------------------------------ text layers as animated subtitles (libass shapes every script)
const ts = (sec: number) => { const cs = Math.round(Math.max(sec, 0) * 100); return `${Math.trunc(cs / 360000)}:${String(Math.trunc(cs / 6000) % 60).padStart(2, "0")}:${String(Math.trunc(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
const assColor = (hexColor: string) => { let h = hexColor.replace(/^#/, ""); if (!/^[0-9A-Fa-f]{6}$/.test(h)) h = "FFFFFF"; return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };
const f0 = (x: number) => x.toFixed(0);
function layerEvents(t: TextLayer, w: number, h: number): [number, number, string][] {
  const text = cleanText(t.text);
  if (!text) return [];
  const x = t.x * w, y = t.y * h, size = t.size * h, fadeOut = t.animationOut === "fade" ? 250 : 0, pos = `\\an5\\pos(${f0(x)},${f0(y)})\\fs${f0(size)}`, outTag = fadeOut ? `\\fad(0,${fadeOut})` : "", a = t.animationIn;
  if (a === "fade") return [[t.start, t.end, `{${pos}\\fad(350,${fadeOut})}${text}`]];
  if (a === "slide_up") return [[t.start, t.end, `{\\an5\\fs${f0(size)}\\move(${f0(x)},${f0(y + 0.03 * h)},${f0(x)},${f0(y)},0,380)\\fad(300,${fadeOut})}${text}`]];
  if (a === "scale") return [[t.start, t.end, `{${pos}\\fscx72\\fscy72\\t(0,320,\\fscx100\\fscy100)\\fad(200,${fadeOut})}${text}`]];
  if (a === "blur_sharp") return [[t.start, t.end, `{${pos}\\blur14\\alpha&HFF&\\t(0,520,\\blur0\\alpha&H00&)${outTag}}${text}`]];
  if (a === "mask_reveal") {
    const bw = Math.max(text.length, 3) * size * 0.62 * 1.15, x0 = x - bw / 2, x1 = x + bw / 2, y0 = y - size, y1 = y + size;
    return [[t.start, t.end, `{${pos}\\clip(${f0(x0)},${f0(y0)},${f0(x0)},${f0(y1)})\\t(0,520,\\clip(${f0(x0)},${f0(y0)},${f0(x1)},${f0(y1)}))${outTag}}${text}`]];
  }
  const n = [...text].length, chars = [...text], steps = Math.min(n, 24), total = Math.min(0.7, Math.max((t.end - t.start) * 0.4, 0.3)), out: [number, number, string][] = [];
  for (let s = 1; s <= steps; s++) {
    const k = Math.round((n * s) / steps), t0 = t.start + (total * (s - 1)) / steps, t1 = s < steps ? t.start + (total * s) / steps : t.end;
    out.push([t0, t1, `{${pos}${s === steps ? outTag : ""}}${chars.slice(0, k).join("")}{\\alpha&HFF&}${chars.slice(k).join("")}`]);
  }
  return out;
}
export function writeTextAss(layers: TextLayer[], style: ProductStyle, file: string, w: number, h: number): string | null {
  const events = layers.flatMap((l) => layerEvents(l, w, h));
  if (!events.length) return null;
  const font = style.font.replace(/[^A-Za-z0-9 \-_.]/g, "").slice(0, 40) || "Arial", spacing = layers.some((l) => /[ऀ-෿]/.test(l.text)) ? "0" : "1.5";
  const lines = ["[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${Math.trunc(0.065 * h)},${assColor(style.textColor)},${assColor(style.textColor)},${assColor(style.textOutline)},&H64000000&,${style.bold ? -1 : 0},0,0,0,100,100,${spacing},0,1,${Math.max(2, Math.trunc(h / 640))},${Math.max(1, Math.trunc(h / 960))},5,20,20,20,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"];
  for (const [s, e, body] of events.sort((a, b) => a[0] - b[0])) lines.push(`Dialogue: 0,${ts(s)},${ts(e)},Default,,0,0,0,,${body}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

/** Make the finished MP4; `images` in the order plan.images refers to. */
export async function renderReel(plan: ProductReelPlan, images: string[], style: ProductStyle, outPath: string, workDir: string, o: { music?: string | null; settings?: RenderSettings; progress?: (f: number) => void; signal?: AbortSignal } = {}) {
  const cv = await opencv(), rs = o.settings ?? FINAL;
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const worlds: World[] = [];
  for (const p of images) worlds.push(new World(cv, matOf(cv, await loadBgr(p))));
  const maker = new FrameMaker(cv, plan, worlds, style, rs), ass = writeTextAss(plan.texts, style, path.join(workDir, "text.ass"), rs.width, rs.height);
  const total = Math.max(Math.round(plan.duration * rs.fps), 1), tmpOut = path.join(workDir, "reel.mp4");
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", `${rs.width}x${rs.height}`, "-r", String(rs.fps), "-i", "pipe:0"];
  if (o.music) args.push("-ss", plan.audioStart.toFixed(3), "-t", (plan.duration + 0.5).toFixed(3), "-i", o.music);
  if (ass) args.push("-vf", assFilter(ass));
  args.push("-map", "0:v");
  if (o.music) { const fo = Math.min(0.9, plan.duration / 3); args.push("-map", "1:a", "-af", `afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(plan.duration - fo, 0).toFixed(3)}:d=${fo.toFixed(3)},volume=${rs.musicVolume.toFixed(2)}`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"); }
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", rs.preset, "-crf", String(rs.crf), "-pix_fmt", "yuv420p", "-r", String(rs.fps), "-t", plan.duration.toFixed(3), "-movflags", "+faststart", tmpOut);
  const proc = spawn(findBinary("ffmpeg"), args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let err = "";
  proc.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  const exited = new Promise<number>((res) => proc.on("close", (c) => res(c ?? -1)));
  let broken = false;
  proc.stdin.on("error", () => { broken = true; });
  try {
    for (let i = 0; i < total && !broken; i++) {
      if (o.signal?.aborted) throw new FFmpegError("Cancelled.", { code: "JOB_CANCELLED" });
      const f = maker.frame(Math.min(i / rs.fps, plan.duration - 1e-4)), buf = Buffer.from(f.data as Uint8Array);
      f.delete();
      if (!proc.stdin.write(buf)) await new Promise<void>((res) => { const done = () => { proc.stdin.off("drain", done); proc.stdin.off("close", done); res(); }; proc.stdin.once("drain", done); proc.stdin.once("close", done); });
      if (o.progress && i % 6 === 0) o.progress(i / total);
      if (i % 30 === 29) await new Promise((res) => setImmediate(res)); // let other requests in
    }
    proc.stdin.end();
    const code = await exited;
    if (code !== 0 || broken) throw new FFmpegError(`The video encoder stopped (exit code ${code}).`, { details: err.slice(-600) });
  } catch (e) {
    proc.kill();
    throw e;
  } finally {
    maker.fx.dispose();
    for (const w of worlds) w.dispose();
  }
  moveFile(tmpOut, outPath);
  o.progress?.(1);
  return outPath;
}
