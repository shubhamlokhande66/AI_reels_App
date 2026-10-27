import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/core/db", () => ({ db: async () => ({}), mainDb: async () => ({}), parseId: String }));
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

  it("a kind with 3 or more seeds learns a style closer to its Reels than the default", () => {
    const byKind = new Map<string, unknown[]>();
    for (const s of seeds) byKind.set(s.category, [...(byKind.get(s.category) ?? []), Fingerprint.parse(s.fp)]);
    for (const [kind, fps] of byKind) {
      if (fps.length < 3) continue;
      const a = accuracy(fps as never)!;
      expect(a.learned, `${kind}: learned ${a.learned} vs default ${a.baseline}`).toBeGreaterThan(a.baseline);
      expect(learn(fps as never)?.moments.length).toBeGreaterThan(0);
    }
  });
});
