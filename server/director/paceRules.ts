import { g, round } from "@/server/core/py";

/** How fast to cut, from how far apart the beats are (was backend/app/director/pace_rules.py): one table, used by the
 * beat-map cut plan and given to the AI editor, so both edit the same way. */

export interface Pace {
  name: string; minGap: number; maxGap: number; stepLoud: number; stepCalm: number; transitionEvery: number;
  maxTransition: number; accents: string[]; summary: string;
}

export const PACES: Pace[] = [
  { name: "slow", minGap: 0.8, maxGap: Infinity, stepLoud: 1, stepCalm: 2, transitionEvery: 3, maxTransition: 0.5, accents: ["zoom_in", "ken_burns"],
    summary: "normal clips, a cut on the beat, smooth transitions (dissolve, slide) on about 1 cut in 3" },
  { name: "medium", minGap: 0.5, maxGap: 0.8, stepLoud: 1, stepCalm: 2, transitionEvery: 4, maxTransition: 0.3, accents: ["zoom_pulse", "punch"],
    summary: "beat-synced cuts (every beat in loud parts, every 2nd in calm ones), an occasional transition on a bar start" },
  { name: "medium_fast", minGap: 0.4, maxGap: 0.5, stepLoud: 2, stepCalm: 2, transitionEvery: 5, maxTransition: 0.2, accents: ["zoom_pulse", "beat_punch"],
    summary: "a cut every 2nd beat with a pulse on the beat between; every beat only in a drop or the most energetic part" },
  { name: "fast", minGap: 0.2, maxGap: 0.4, stepLoud: 2, stepCalm: 3, transitionEvery: 8, maxTransition: 0.15, accents: ["beat_punch", "beat_flash"],
    summary: "a cut on every 2nd hit (0.4-0.8 s shots) with punch-ins / flashes on the hits between; fast-cut bursts only in a build-up (2 s at most)" },
  { name: "roll", minGap: 0, maxGap: 0.2, stepLoud: 4, stepCalm: 6, transitionEvery: 0, maxTransition: 0, accents: ["beat_stutter", "zoom_pulse", "speed_ramp"],
    summary: "no cut per hit: a longer shot with rapid accents (stutter punches, pulses) or a speed ramp; a 2-3 cut burst only into a drop" },
];
const DROP_EVERY_BEAT = ["medium_fast"];
export const DROP_BARS = 2;

export const paceFor = (gap: number): Pace => PACES.find((p) => p.minGap <= gap && gap < p.maxGap) ?? PACES[0];

/** Beats per cut here: the table, then build-ups (faster) and breakdowns (slower), never under `minShot`. */
export function cutStep(pace: Pace, gap: number, loud: boolean, trend = "", inDrop = false, minShot = 0.35): number {
  let step = loud ? pace.stepLoud : pace.stepCalm;
  if (inDrop && loud && DROP_EVERY_BEAT.includes(pace.name)) step = 1;
  if (trend === "rise") step = Math.max(1, Math.floor(step / 2));
  else if (trend === "fall") step *= 2;
  return Math.max(step, Math.ceil(minShot / Math.max(gap, 1e-3) - 1e-9));
}

/** A smooth transition on this cut? About one every `transitionEvery` cuts, preferably on a bar start. */
export function wantsTransition(pace: Pace, cutsSince: number, onBar: boolean): boolean {
  if (pace.transitionEvery <= 0) return false;
  return cutsSince >= pace.transitionEvery || (onBar && cutsSince >= Math.max(pace.transitionEvery - 1, 1));
}

/** How long a transition may last: the pace's limit, under half a beat, at most ~40% of the shot. */
export function transitionSeconds(pace: Pace, wanted: number, gap: number, shot: number | null = null): number {
  const limit = Math.min(pace.maxTransition, gap * 0.45, ...(shot ? [shot * 0.4] : []));
  return round(Math.max(Math.min(wanted, limit), 0), 2);
}

/** The rules for the AI editor: the whole table and the pace of this song. */
export function describePace(gap: number) {
  const p = paceFor(gap);
  return {
    this_song: {
      beat_gap_sec: round(gap, 3), pace: p.name, how_to_cut: p.summary, beats_per_cut_loud: p.stepLoud, beats_per_cut_calm: p.stepCalm,
      one_smooth_transition_every_n_cuts: p.transitionEvery || null, max_transition_sec: p.maxTransition, accents_between_cuts: [...p.accents],
    },
    table: PACES.map((x) => ({ beat_gap_sec: x.maxGap !== Infinity ? `${g(x.minGap)}-${g(x.maxGap)}` : `> ${g(x.minGap)}`, pace: x.name, how_to_cut: x.summary })),
    always: [
      "build-ups (BUILD_UP / ENERGY_RISE) cut twice as fast, breakdowns (ENERGY_DROP) twice as slow",
      "a MUSIC_DROP always gets a cut: the hero shot with CRASH_ZOOM, entered with a FLASH",
      "SILENCE: hold the shot or fade; never cut in the middle of silence",
      "no shot shorter than the minimum clip length; a transition at most 40% of its shot",
    ],
  };
}
