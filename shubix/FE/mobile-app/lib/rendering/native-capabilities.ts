/**
 * Single source of truth for the currently shipped Android Media3 export subset.
 * Keep these checks pure so UI, project conversion and export validation agree.
 */
const TRANSITIONS: Record<string, string> = {
  fade: "fade", fadein: "fade",
  zoom: "zoom-in", zoomin: "zoom-in", zoomout: "zoom-out",
  blur: "blur", flash: "flash", whip: "whip-pan", whippan: "whip-pan",
  spin: "spin", slideleft: "slide-left", slideright: "slide-right",
  slideup: "slide-up", slidedown: "slide-down", swipeup: "slide-up",
};

const EFFECTS = new Set([
  "blur", "blurpulse", "brightness", "contrast", "saturation", "hue",
  "punch", "punch-soft", "pan-soft", "zoomburst", "drift", "shake",
  "bounce", "tilt", "snap", "hook", "jump", "pan", "heartbeat",
]);

const FILTERS = new Set([
  "Original", "Noir", "Golden", "Film", "Soft", "Vivid", "Cinematic",
  "Warm", "Cool", "Teal & Orange", "Sepia", "Matte", "High Contrast",
  "Faded", "Vintage", "Pastel", "Cyberpunk", "Dreamy", "Black & White",
  "Soft Focus", "Color Pop", "Muted", "Sunset", "Arctic",
]);

const compact = (value: string) => value.trim().toLowerCase().replace(/[\s_-]/g, "");

export function normalizeAndroidTransition(id: string): string | undefined {
  if (id.trim().toLowerCase() === "cut" || id.trim().toLowerCase() === "hard") return undefined;
  return TRANSITIONS[compact(id)];
}

export function isAndroidTransitionSupported(id: string): boolean {
  return id.trim().toLowerCase() === "cut" || id.trim().toLowerCase() === "hard" || !!normalizeAndroidTransition(id);
}

export function isAndroidEffectSupported(id: string): boolean {
  return id.trim().toLowerCase() === "none" || EFFECTS.has(id.trim().toLowerCase());
}

export function isAndroidFilterSupported(id: string): boolean {
  return FILTERS.has(id);
}

