/** A clip's analysis and what the vision model saw in it (were models/analysis.ClipAnalysis / UsableWindow and
 * ai/understanding.ClipSemantic), camelCase like their stored JSON. */

export const PAN_MIN = 0.04;

export interface VideoMetadata {
  duration: number; width: number; height: number; fps: number; codec: string; hasAudio: boolean; rotation: number;
  bitRate: number | null; orientation: "landscape" | "portrait" | "square";
}

export interface UsableWindow {
  start: number; end: number; quality: number; motion: number; brightness: number; sharpness: number;
  focusX: number; focusY: number; face: boolean; focusSource: "face" | "subject" | "motion" | "center";
  signature: number[]; shot: number; motionCurve: number[]; curveDt: number; panX: number; panY: number;
  shotSize: "close" | "medium" | "wide" | "unknown"; composition: number; subject: number; cameraMotion: number; subjectMotion: number; empty: number;
}

export type MomentKind = "action_peak" | "camera_settles" | "face_appears" | "focus_peak" | "subject_close" | "reveal";
export interface Moment { t: number; kind: MomentKind; score: number; reason: string }
export interface BestSegment { start: number; end: number; score: number; moment: MomentKind | null; reason: string }

export interface ClipAnalysis {
  clipId: string; metadata: VideoMetadata; qualityScore: number; motionScore: number; brightnessScore: number; sharpnessScore: number;
  shakeScore: number; contentRect: number[] | null; resolutionScore: number; duplicateRatio: number; sceneChanges: number[]; flags: string[];
  usable: boolean; windows: UsableWindow[]; analysisVersion: number; compositionScore: number; subjectScore: number; cameraMotionScore: number;
  subjectMotionScore: number; shotSizes: Record<string, number>; moments: Moment[]; bestSegments: BestSegment[]; productVisibility: number | null;
}

export interface ClipSemantic {
  clipId: string; scene: string; objects: string[]; people: number; action: string; camera: string; tags: string[]; summary: string;
  importance: number; mood: string; category: string; stage: string; hookCandidate: boolean; endingCandidate: boolean; version: number;
  model: string; analyzedAt: string;
}

export function windowDefaults(w: Partial<UsableWindow> & Pick<UsableWindow, "start" | "end" | "quality" | "motion" | "brightness" | "sharpness">): UsableWindow {
  return {
    focusX: 0.5, focusY: 0.5, face: false, focusSource: "center", signature: [], shot: 0, motionCurve: [], curveDt: 0.25, panX: 0, panY: 0,
    shotSize: "unknown", composition: 0.5, subject: 0, cameraMotion: 0, subjectMotion: 0, empty: 0, ...w,
  };
}

export function clipDefaults(c: Partial<ClipAnalysis> & Pick<ClipAnalysis, "clipId" | "metadata" | "qualityScore" | "motionScore" | "brightnessScore" | "sharpnessScore">): ClipAnalysis {
  return {
    shakeScore: 0, contentRect: null, resolutionScore: 1, duplicateRatio: 0, sceneChanges: [], flags: [], usable: true, analysisVersion: 1,
    compositionScore: 0.5, subjectScore: 0, cameraMotionScore: 0, subjectMotionScore: 0, shotSizes: {}, moments: [], bestSegments: [], productVisibility: null,
    ...c, windows: (c.windows ?? []).map((w) => windowDefaults(w)),
  };
}

export function semanticDefaults(s: Partial<ClipSemantic> & { clipId: string }): ClipSemantic {
  return {
    scene: "", objects: [], people: 0, action: "", camera: "medium", tags: [], summary: "", importance: 0.5, mood: "", category: "other", stage: "other",
    hookCandidate: false, endingCandidate: false, version: 1, model: "", analyzedAt: "", ...s,
  };
}

export const windowLength = (w: Pick<UsableWindow, "start" | "end">) => w.end - w.start;

/** left | right | up | down | still: the way the picture moves. */
export function direction(w: UsableWindow): string {
  if (Math.max(Math.abs(w.panX), Math.abs(w.panY)) < PAN_MIN) return "still";
  if (Math.abs(w.panX) >= Math.abs(w.panY)) return w.panX > 0 ? "right" : "left";
  return w.panY > 0 ? "down" : "up";
}

/** Mean motion of the window's sub-range [a, b] (clip time). */
export function motionBetween(w: UsableWindow, a: number, b: number): number {
  if (!w.motionCurve.length) return w.motion;
  const i = Math.max(Math.trunc((a - w.start) / w.curveDt), 0);
  const j = Math.max(Math.trunc((b - w.start) / w.curveDt) + 1, i + 1);
  let seg = w.motionCurve.slice(i, j);
  if (!seg.length) seg = w.motionCurve.slice(-1);
  return seg.reduce((x, y) => x + y, 0) / seg.length;
}

/** The words that describe a clip (relevance and search). */
export function semanticTerms(s: ClipSemantic): Set<string> {
  const text = [s.scene, s.action, s.summary, ...s.objects, ...s.tags, s.camera].join(" ").toLowerCase();
  return new Set((text.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2));
}

/** A clip as the editing engine sees it. */
export interface ClipInput { clipId: string; name: string; analysis: ClipAnalysis; semantic: ClipSemantic | null }
