/** The manual editor's live preview: browser (CSS) approximations of the renderer's effects, looks and transitions, so
 * edits are seen instantly. The exported video is made by FFmpeg and is exact; these only have to feel the same. */

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

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** The picture's transform / filter for an effect at progress p (0..1) through the shot, ``secs`` seconds in. */
export function effectStyle(effect: string, p: number, secs: number): { transform: string; filter: string } {
  const e = ease(Math.min(Math.max(p, 0), 1));
  let s = 1;
  let x = 0;
  let y = 0;
  let r = 0;
  let filter = "";
  switch (effect) {
    case "zoom_in":
      s = 1 + 0.15 * e;
      break;
    case "zoom_out":
      s = 1.15 - 0.15 * e;
      break;
    case "ken_burns":
      s = 1.06 + 0.1 * e;
      x = -3 + 6 * e;
      break;
    case "pan_left":
      s = 1.12;
      x = 4 - 8 * e;
      break;
    case "pan_right":
      s = 1.12;
      x = -4 + 8 * e;
      break;
    case "pan_up":
      s = 1.12;
      y = 4 - 8 * e;
      break;
    case "pan_down":
      s = 1.12;
      y = -4 + 8 * e;
      break;
    case "punch":
    case "beat_punch":
      s = secs < 0.18 ? 1.12 - (secs / 0.18) * 0.12 : 1;
      break;
    case "punch_out":
      s = secs < 0.2 ? 0.92 + (secs / 0.2) * 0.08 : 1;
      break;
    case "zoom_pulse":
      s = 1 + 0.05 * Math.abs(Math.sin(secs * Math.PI * 2));
      break;
    case "crash_zoom":
      s = secs < 0.25 ? 1.35 - (secs / 0.25) * 0.3 : 1.05;
      break;
    case "shake":
      x = Math.sin(secs * 47) * 1.2;
      y = Math.cos(secs * 53) * 1.2;
      s = 1.05;
      break;
    case "roll":
      r = -2 + 4 * e;
      s = 1.08;
      break;
    case "flash":
    case "beat_flash":
      filter = secs < 0.15 ? `brightness(${1.9 - (secs / 0.15) * 0.9})` : "";
      break;
    case "black_white":
      filter = "grayscale(1)";
      break;
    case "glow":
      filter = "brightness(1.08) saturate(1.15) contrast(0.96)";
      break;
    case "sharpen":
      filter = "contrast(1.12)";
      break;
    case "freeze":
      break;
  }
  return { transform: `translate(${x}%, ${y}%) scale(${s}) rotate(${r}deg)`, filter };
}

/** How the incoming shot appears during a transition, at progress p (0 = starts, 1 = fully in). Approximate families. */
export function transitionStyle(type: string, p: number): { opacity: number; clipPath?: string; transform?: string; filter?: string } {
  const e = ease(Math.min(Math.max(p, 0), 1));
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
  if (type === "flash") return { opacity: e, filter: `brightness(${1 + (1 - e) * 1.5})` };
  if (type === "fade_grays") return { opacity: e, filter: `grayscale(${1 - e})` };
  return { opacity: e }; // fade, dissolve, speed ramp ...
}
