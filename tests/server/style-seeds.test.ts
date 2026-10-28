import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/core/db", () => ({ db: async () => ({}), mainDb: async () => { throw new Error("no database here"); }, parseId: String }));
vi.mock("@/server/core/auth", () => ({ currentUser: () => null }));

/** The style library: the app's own Reels (seed-styles.json) must all be valid fingerprints of a known kind, and the
 * style learned from them must predict a Reel of its kind left out better than the default style. */
describe("style seeds", async () => {
  const { Fingerprint, CATEGORIES, learn, accuracy } = await import("@/server/studio/styles");
  const seeds = (await import("@/server/studio/seed-styles.json")).default as { name: string; category: string; fp: unknown }[];

  it("every seed is a valid fingerprint of a known kind", () => {
    for (const s of seeds) {
      expect(CATEGORIES).toContain(s.category);
      const r = Fingerprint.safeParse(s.fp);
      expect(r.success, `${s.name}: ${r.success ? "" : r.error.message}`).toBe(true);
    }
  });

  it("keeps flickers, blur transitions, the black end and up to 200 shots", () => {
    const fp = Fingerprint.parse({ dur: 30, bpm: 140, medianBeats: 1, medianSec: 0.4, hookBeats: 1, hookSec: 0.3, onBeat: 0.5, energy: "steady", zoomShare: 0.1,
      trans: { hard: 0.8, blur: 0.2 }, look: null, shotBeats: [], shotSec: [],
      moments: Array.from({ length: 150 }, (_, i) => ({ beats: 0.5, sec: 0.2, tr: i % 5 ? "hard" : "blur", zoom: "none", at: i * 0.2, ...(i === 30 ? { flick: true } : {}), ...(i === 149 ? { black: true } : {}) })) });
    expect(fp.moments).toHaveLength(150);
    expect(fp.moments[30].flick).toBe(true);
    expect(fp.moments[149].black).toBe(true);
    expect(fp.trans.blur).toBe(0.2);
  });

  // Reels of one kind differ a lot (a 0.4 s montage and a 4 s showroom walk): with a few of them a kind may predict a
  // new Reel a little worse than the default (never by more than 0.05); over all kinds learning must be better
  it("the styles learned from the seeds predict a Reel of their kind better than the default, over all kinds", () => {
    const byKind = new Map<string, unknown[]>();
    for (const s of seeds) byKind.set(s.category, [...(byKind.get(s.category) ?? []), Fingerprint.parse(s.fp)]);
    let l = 0, d = 0, n = 0;
    for (const [kind, fps] of byKind) {
      if (fps.length < 3) continue;
      const a = accuracy(fps as never)!;
      expect(a.learned, `${kind}: learned ${a.learned} vs default ${a.baseline}`).toBeGreaterThan(a.baseline - 0.05);
      expect(learn(fps as never)?.moments.length).toBeGreaterThan(0);
      l += a.learned * fps.length; d += a.baseline * fps.length; n += fps.length;
    }
    if (n) expect(l / n).toBeGreaterThan(d / n);
  });

  it("gives the AI every kind's trend, the template's kind first, and lets it pick the kind otherwise", async () => {
    const { trendText } = await import("@/server/studio/styles");
    const any = await trendText();
    expect(any).toMatch(/^WHAT TRENDING REELS OF EACH KIND DO/);
    expect(any).toMatch(/- car \(\d+ Reels\): a cut every/);
    expect(any).toMatch(/flicker montages/);
    expect(any).toMatch(/Decide from the clips which kind this Reel is/);
    const car = await trendText("shop");
    expect(car.split("\n")[1]).toMatch(/^- shop /);
    expect(car).toMatch(/This Reel is a shop Reel/);
    expect(await trendText("wedding")).toMatch(/Decide from the clips/);   // no Reels of that kind: the AI picks
  });
});
