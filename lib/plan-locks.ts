/** Which plan unlocks what in Fast Studio, the way CapCut and InShot do it: the whole editor is free (keyframes, green
 * screen, overlays, sound effects), and a part of each library (effects, transitions, filters, fonts, text styles)
 * plus a few advanced tools carry a crown for a paid plan. People can try a crowned item in the preview; exporting
 * with one asks them to upgrade or to take it out. Export quality and the watermark follow the plan too.
 * The administrator can move any item to another plan (Admin → Settings → Plan locks); these are the defaults. */

export const PLANS = ["free", "creator", "pro", "business"] as const;
export type PlanId = (typeof PLANS)[number];
export const PLAN_NAME: Record<PlanId, string> = { free: "Free", creator: "Creator", pro: "Pro", business: "Business" };
/** a plan's place in the order: an item needing "creator" is open to creator, pro and business */
export const planRank = (p: string | null | undefined) => { const i = PLANS.indexOf((p || "free") as PlanId); return i < 0 ? 0 : i; };

export interface LockItem { key: string; name: string; plan: PlanId }
export interface LockGroup { id: string; name: string; items: LockItem[] }
export interface ExportRule { maxRes: "720" | "1080" | "4k"; fps60: boolean; noWatermark: boolean }
export interface PlanLocks { groups: LockGroup[]; export: Record<PlanId, ExportRule> }

const I = (plan: PlanId, list: [string, string][]): LockItem[] => list.map(([key, name]) => ({ key, name, plan }));
export const DEFAULT_LOCKS: PlanLocks = {
  groups: [
    { id: "fx", name: "Effects", items: [
      ...I("free", [["hook", "Hook zoom"], ["zoomburst", "Zoom burst"], ["punch", "Zoom punch"], ["punch-soft", "Soft zoom"], ["tilt", "Tilt punch"], ["shake", "Shake"], ["bounce", "Beat bounce"], ["pan", "Ken Burns"], ["pan-soft", "Ken Burns soft"], ["drift", "Slow drift"], ["snap", "Photo snap"],
        ["boxgrow", "Box grows on the beat"], ["frame", "Frame in frame"], ["circle", "Circle pulse"]]),
      ...I("creator", [["grid", "Grid opens"], ["strips", "Strips"], ["heartbeat", "Heart pulse"], ["starbeat", "Star pulse"], ["mirror", "Mirror"], ["kaleido", "Kaleidoscope"], ["triple", "Triple split"], ["vhs", "VHS retro"], ["strobe", "Strobe"], ["rgbpulse", "RGB split"], ["blurpulse", "Blur pulse"]]) ] },
    { id: "tr", name: "Transitions", items: [
      ...I("free", [["fadein", "Fade-in"], ["flash", "Flash"], ["whip", "Whip pan"], ["zoom", "Zoom-through"], ["glitch", "Glitch"], ["dip", "Dip to black"], ["dissolve", "Dissolve"], ["iris", "Iris"], ["wipe", "Wipe"], ["bars", "Bars"], ["spin", "Spin"], ["diamond", "Diamond"], ["heart", "Heart"], ["star", "Star"],
        ["slideleft", "Push left"], ["slideright", "Push right"]]),
      ...I("creator", [["slideup", "Push up"], ["slidedown", "Push down"], ["swipeup", "Swipe up"], ["zoomout", "Zoom out"], ["blur", "Blur through"], ["flip", "Card flip"], ["luma", "Light fade"], ["pixelate", "Pixelate"], ["clock", "Clock wipe"], ["doors", "Doors open"], ["ripple", "Ripple"], ["burn", "Film burn"], ["dropin", "Drop in"]]) ] },
    { id: "look", name: "Filters", items: [
      ...I("free", [["natural", "Natural"], ["vivid", "Vivid"], ["cine", "Cinematic"], ["mono", "B&W"], ["warmfilm", "Warm film"], ["cool", "Cool"], ["faded", "Faded"], ["summer", "Summer"], ["moody", "Moody"], ["wedding", "Wedding"]]),
      ...I("creator", [["retro", "Retro"], ["golden", "Golden hour"], ["tealorange", "Teal & orange"], ["noir", "Noir"], ["sepia", "Sepia"], ["cyber", "Cyber"], ["pastel", "Pastel"], ["dramatic", "Dramatic"], ["night", "Night"], ["vintage", "Vintage"], ["matte", "Matte"], ["punchy", "Punchy"], ["forest", "Forest"], ["rose", "Rose"]]) ] },
    { id: "font", name: "Fonts", items: [
      ...I("free", [["anton", "Anton"], ["bebas", "Bebas Neue"], ["poppins", "Poppins"], ["montserrat", "Montserrat"], ["mukta", "Mukta"], ["baloo", "Baloo 2"]]),
      ...I("creator", [["oswald", "Oswald"], ["bangers", "Bangers"], ["marker", "Permanent Marker"], ["pacifico", "Pacifico"], ["lobster", "Lobster"], ["dancing", "Dancing Script"], ["caveat", "Caveat"], ["playfair", "Playfair"], ["yatra", "Yatra One"], ["kalam", "Kalam"], ["rozha", "Rozha One"]]) ] },
    { id: "text", name: "Text styles", items: [
      ...I("free", [["box", "Box"], ["neon", "Neon"], ["clean", "Clean"], ["tag", "Tag"], ["outline", "Outline"], ["shadow", "Hard shadow"], ["bubble", "Speech bubble"]]),
      ...I("creator", [["glow", "Soft glow"], ["stack", "Double outline"]]) ] },
    { id: "tool", name: "Tools", items: [
      ...I("free", [["keyframes", "Keyframes"], ["overlay", "Overlay / picture in picture"], ["chroma", "Green screen"], ["blend", "Blend modes"], ["sfx", "Sound effects"], ["freeze", "Freeze frame"], ["gif", "GIF overlay"]]),
      ...I("creator", [["beauty", "Beauty (smooth skin)"], ["curve", "Speed curve"], ["stab", "Stabilize"], ["track", "Text follows the person"]]) ] },
  ],
  export: {
    free: { maxRes: "1080", fps60: false, noWatermark: false },
    creator: { maxRes: "1080", fps60: true, noWatermark: true },
    pro: { maxRes: "4k", fps60: true, noWatermark: true },
    business: { maxRes: "4k", fps60: true, noWatermark: true },
  },
};

/** the administrator's changes over the defaults: { "fx:grid": "free", ... } and export rules per plan */
export interface LockOverrides { items?: Record<string, PlanId>; export?: Partial<Record<PlanId, Partial<ExportRule>>> }
export function applyOverrides(o: LockOverrides | null | undefined): PlanLocks {
  const items = o?.items ?? {}, ex = o?.export ?? {};
  return {
    groups: DEFAULT_LOCKS.groups.map((g) => ({ ...g, items: g.items.map((it) => { const v = items[`${g.id}:${it.key}`]; return PLANS.includes(v as PlanId) ? { ...it, plan: v as PlanId } : it; }) })),
    export: Object.fromEntries(PLANS.map((p) => [p, { ...DEFAULT_LOCKS.export[p], ...(ex[p] ?? {}) }])) as Record<PlanId, ExportRule>,
  };
}
/** item key -> the plan it needs, for quick lookups ("fx:grid" -> "creator") */
export const needMap = (L: PlanLocks) => Object.fromEntries(L.groups.flatMap((g) => g.items.map((it) => [`${g.id}:${it.key}`, it.plan])));
