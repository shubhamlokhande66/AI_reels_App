import type { Framing } from "@/types/api";

/** Edit operations understood by POST /timeline/ops. The server validates every one of them. */
export const op = {
  trim: (segmentId: string, sourceStart?: number, sourceEnd?: number) => ({ type: "trim", segmentId, sourceStart, sourceEnd }),
  setLength: (segmentId: string, length: number) => ({ type: "set_length", segmentId, length }),
  move: (segmentId: string, toIndex: number) => ({ type: "move", segmentId, toIndex }),
  split: (segmentId: string, at: number) => ({ type: "split", segmentId, at }),
  remove: (segmentId: string) => ({ type: "delete", segmentId }),
  duplicate: (segmentId: string) => ({ type: "duplicate", segmentId }),
  replace: (segmentId: string, clipId: string, sourceStart = 0) => ({ type: "replace", segmentId, clipId, sourceStart }),
  speed: (segmentId: string, speed: number) => ({ type: "set_speed", segmentId, speed }),
  transition: (segmentId: string, transition: string, duration?: number) => ({ type: "set_transition", segmentId, transition, duration }),
  effect: (segmentId: string, effect: string) => ({ type: "set_effect", segmentId, effect }),
  framing: (segmentId: string, framing: Framing) => ({ type: "set_crop", segmentId, crop: { framing } }),
  music: (m: { volume?: number; fadeIn?: number; fadeOut?: number; audioStart?: number }) => ({ type: "set_music", ...m }),
  addCaption: (start: number, end: number, text: string) => ({ type: "add_caption", start, end, text }),
  updateCaption: (captionId: string, p: { start?: number; end?: number; text?: string }) => ({ type: "update_caption", captionId, ...p }),
  deleteCaption: (captionId: string) => ({ type: "delete_caption", captionId }),
  captionStyle: (style: string) => ({ type: "set_caption_style", style }),
  fitDuration: (target: number) => ({ type: "fit_duration", target }),
  voiceMix: (m: { volume?: number; duckMusic?: boolean; start?: number }) => ({ type: "set_voice_mix", ...m }),
  fitToVoice: (tail = 0.8) => ({ type: "fit_to_voice", tail }),
};

// Keep in sync with the registry in backend/app/video/transitions.py — every one of these is a real FFmpeg xfade
// transition (or the speed ramp), genuinely rendered, the same catalogue paid editors offer.
export const TRANSITIONS = [
  "cut", "fade", "dissolve", "zoom", "slide", "blur", "flash", "speed_ramp",
  "wipe_left", "wipe_right", "wipe_up", "wipe_down", "wipe_tl", "wipe_tr", "wipe_bl", "wipe_br",
  "slide_left", "slide_right", "slide_down",
  "smooth_left", "smooth_right", "smooth_up", "smooth_down",
  "circle_open", "circle_close", "circle_crop", "rect_crop",
  "vert_open", "vert_close", "horz_open", "horz_close",
  "distance", "radial", "pixelize",
  "diag_tl", "diag_tr", "diag_bl", "diag_br",
  "slice_h_left", "slice_h_right", "slice_v_up", "slice_v_down",
  "squeeze_h", "squeeze_v", "wind_left", "wind_right",
  "cover_left", "cover_right", "cover_up", "cover_down",
  "reveal_left", "reveal_right", "reveal_up", "reveal_down",
  "fade_grays",
] as const;
// Keep in sync with the effect registry (backend/app/video/effects.py).
export const EFFECTS = ["none", "zoom_in", "zoom_out", "punch", "zoom_pulse", "punch_out", "pan_left", "pan_right", "pan_up", "pan_down", "ken_burns", "crash_zoom", "shake", "roll", "flash", "black_white", "beat_punch", "beat_flash"] as const;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
