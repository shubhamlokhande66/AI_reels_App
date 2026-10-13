import { ValidationFailed } from "@/server/core/errors";
import { round } from "@/server/core/py";
import BUILTIN from "./builtin.json";

/** Editing styles (was backend/app/styles): pure data the timeline builder and composer read. The built-ins are the
 * Python registry exported as builtin.json (exact values). */

export interface EditingStyle {
  id: string; name: string; description: string;
  cutBeatsHigh: number; cutBeatsLow: number; minSegment: number; maxSegment: number;
  transitions: Record<string, number>; transitionDuration: number; maxTransitionRatio: number;
  effects: Record<string, number>; slowMotionChance: number; slowMotionSpeed: number;
  motionPreference: number; opening: "establishing" | null; closing: "reveal" | null; preferLandscape: boolean;
  gradeFilter: string | null; captionStyle: string; audioFadeIn: number; audioFadeOut: number; fadeInOut: number;
  accentHits: boolean; sectionPacing: boolean; hookPriority: number; subjectPriority: number; shakeTolerance: number;
}

const REGISTRY = new Map<string, EditingStyle>((BUILTIN as unknown as EditingStyle[]).map((s) => [s.id, s]));
export const AUTO_STYLE = "auto";

export const listStyles = () => [...REGISTRY.values()];
export const withOverrides = (s: EditingStyle, o: Partial<EditingStyle>): EditingStyle => ({ ...s, ...o });

export function getStyle(id: string): EditingStyle {
  const s = REGISTRY.get(id);
  if (!s) throw new ValidationFailed(`Unknown style '${id}'.`, { code: "UNKNOWN_STYLE", details: { available: [...REGISTRY.keys()].sort() } });
  return s;
}

/** Any registered style or "auto". */
export function validateStyleId(id: string): string {
  if (id !== AUTO_STYLE) getStyle(id);
  return id;
}

// (beats multiplier, min-shot multiplier, max-shot multiplier); "auto": the AI decides, the rules use balanced
export const PACE_FACTORS: Record<string, [number, number, number]> = { calm: [2.0, 1.7, 1.4], balanced: [1, 1, 1], fast: [0.5, 0.6, 0.8] };

/** Scale the style's cutting speed; "balanced" leaves it untouched. */
export function applyPace(style: EditingStyle, pace: string): EditingStyle {
  const [beats, lo, hi] = PACE_FACTORS[pace] ?? PACE_FACTORS.balanced;
  if (beats === 1 && lo === 1 && hi === 1) return style;
  return withOverrides(style, {
    cutBeatsHigh: Math.max(1, round(style.cutBeatsHigh * beats)), cutBeatsLow: Math.max(1, round(style.cutBeatsLow * beats)),
    minSegment: round(style.minSegment * lo, 3), maxSegment: round(style.maxSegment * hi, 3),
  });
}
