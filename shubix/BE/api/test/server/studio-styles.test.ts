// @vitest-environment node
import { describe, expect, it } from "vitest";
import { accuracy, DEFAULT_STYLE, distance, Fingerprint, learn, SaveIn, withCorrections, type Fingerprint as FP } from "../../src/server/studio/styles";

/** Fast Studio's style library: a learned style is what the Reels of one kind share, it predicts a new Reel of that kind
 * better than knowing nothing, the creator's corrections move it, and only well-formed fingerprints are kept. */
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const jit = (x: number, a: number) => x * (1 + (rnd() * 2 - 1) * a);
function wedding(): FP {   // calm: a cut every ~4 beats, dissolves and fades, few zooms, warm soft look
  const d = jit(0.55, 0.3), f = jit(0.2, 0.4);
  return Fingerprint.parse({ dur: jit(30, 0.2), bpm: jit(90, 0.1), medianBeats: Math.round(jit(4, 0.25)), medianSec: jit(2.6, 0.2), hookBeats: 4, hookSec: 2.6, onBeat: jit(0.8, 0.1), energy: "steady",
    zoomShare: jit(0.15, 0.4), trans: { dissolve: d, fade: f, hard: Math.max(0, 1 - d - f) }, look: { mean: jit(0.5, 0.1), std: jit(0.18, 0.1), sat: jit(0.3, 0.15), warm: jit(0.08, 0.3) },
    shotBeats: Array.from({ length: 10 }, () => Math.round(jit(4, 0.3))), shotSec: [] });
}
function dance(): FP {     // fast: a cut every beat, flashes and whips, zooms, punchy look
  const fl = jit(0.3, 0.3), wh = jit(0.25, 0.3);
  return Fingerprint.parse({ dur: jit(15, 0.2), bpm: jit(128, 0.05), medianBeats: 1, medianSec: jit(0.47, 0.1), hookBeats: 2, hookSec: 0.9, onBeat: jit(0.92, 0.05), energy: "rising",
    zoomShare: jit(0.55, 0.2), trans: { flash: fl, whip: wh, hard: Math.max(0, 1 - fl - wh) }, look: { mean: jit(0.4, 0.1), std: jit(0.27, 0.1), sat: jit(0.55, 0.15), warm: jit(-0.02, 1) },
    shotBeats: Array.from({ length: 20 }, () => Math.max(1, Math.round(jit(1, 0.4)))), shotSec: [] });
}

describe("learning a style", () => {
  const W = Array.from({ length: 12 }, wedding), D = Array.from({ length: 12 }, dance);
  it("keeps what the Reels of a kind share", () => {
    const w = learn(W)!, d = learn(D)!;
    expect(w.medianBeats).toBeGreaterThanOrEqual(3); expect(d.medianBeats).toBe(1);
    expect((w.trans.dissolve ?? 0) + (w.trans.fade ?? 0)).toBeGreaterThan(0.6);
    expect((d.trans.flash ?? 0) + (d.trans.whip ?? 0)).toBeGreaterThan(0.45);
    expect(d.zoomShare).toBeGreaterThan(w.zoomShare);
    expect(Object.values(w.trans).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(W.some((f) => f.shotBeats === w.shotBeats)).toBe(true);   // the rhythm of a real Reel of the kind
  });
  it("predicts a new Reel of its kind far better than knowing nothing (leave one out)", () => {
    const aw = accuracy(W)!, ad = accuracy(D)!;
    expect(aw.learned).toBeGreaterThan(aw.baseline + 0.15); expect(ad.learned).toBeGreaterThan(ad.baseline + 0.1);
    expect(aw.learned).toBeGreaterThan(0.85); expect(ad.learned).toBeGreaterThan(0.85);
  });
  it("tells kinds apart: a wedding is closer to the learned wedding style than to the dance one", () => {
    const w = learn(W)!, d = learn(D)!;
    for (let k = 0; k < 10; k++) { const nw = wedding(), nd = dance(); expect(distance(w, nw).total).toBeLessThan(distance(d, nw).total); expect(distance(d, nd).total).toBeLessThan(distance(w, nd).total); }
  });
  it("needs at least 3 Reels to measure itself, and nothing to learn from nothing", () => {
    expect(accuracy(W.slice(0, 2))).toBeNull(); expect(learn([])).toBeNull();
    expect(distance(DEFAULT_STYLE, DEFAULT_STYLE).total).toBe(0);
  });
});

describe("learning from Reels read on a phone", () => {
  it("a Reel without a steady beat (0 beats, paced in seconds) does not pull the others' pace down", () => {
    const W = Array.from({ length: 6 }, wedding), free = { ...wedding(), medianBeats: 0, hookBeats: 0, bpm: 0, shotBeats: [], shotSec: [2.5, 2.7, 2.4] };
    const l = learn([...W, free, { ...free }])!;
    expect(l.medianBeats).toBe(learn(W)!.medianBeats); expect(l.bpm).toBeGreaterThan(70);
    expect(l.shotBeats.length).toBeGreaterThan(0);   // the rhythm comes from a Reel paced in beats
  });
  it("most Reels without a beat: the style is paced in seconds", () => {
    const S = Array.from({ length: 5 }, () => ({ ...wedding(), medianBeats: 0, hookBeats: 0, bpm: 0, shotBeats: [], shotSec: [2, 2.2, 2.1] }));
    const l = learn([...S, wedding()])!;
    expect(l.medianBeats).toBe(0); expect(l.shotSec.length).toBe(3);
  });
  it("averages each colour number over the Reels that measured it", () => {
    const a = { ...wedding(), look: { mean: 0.4, std: 0.2 } }, b = { ...wedding(), look: { mean: 0.6, std: 0.2, sat: 0.5, vig: 0.3 } };
    const l = learn([a, b])!;
    expect(l.look!.mean).toBeCloseTo(0.5, 5); expect(l.look!.sat).toBeCloseTo(0.5, 5); expect(l.look!.vig).toBeCloseTo(0.3, 5);
  });
  it("corrections to the shape reveals and glitches move the mix too", () => {
    const base = learn(Array.from({ length: 6 }, wedding))!;
    for (const k of ["glitch", "spin", "iris", "diamond", "heart", "star", "wipe", "bars"]) {
      const after = withCorrections(base, Array.from({ length: 6 }, () => ({ field: "tr", from: "dissolve", to: k })));
      expect(after.trans[k as keyof FP["trans"]] ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("corrections", () => {
  it("move the transition mix toward what the creator picks, and stay a mix", () => {
    const base = learn(Array.from({ length: 6 }, wedding))!;
    const after = withCorrections(base, Array.from({ length: 8 }, () => ({ field: "tr", from: "dissolve", to: "flash" })));
    expect(after.trans.flash ?? 0).toBeGreaterThan(base.trans.flash ?? 0);
    expect(after.trans.dissolve ?? 0).toBeLessThan(base.trans.dissolve ?? 0);
    expect(Object.values(after.trans).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(withCorrections(base, [{ field: "efx", from: "punch", to: "none" }])).toBe(base);   // only transitions shape the mix
  });
});

describe("what is kept", () => {
  it("only well-formed fingerprints, a known kind of Reel, no video", () => {
    const fp = wedding();
    expect(SaveIn.safeParse({ name: "my wedding reel", category: "wedding", fp }).success).toBe(true);
    expect(SaveIn.safeParse({ name: "x", category: "cars", fp }).success).toBe(false);
    expect(SaveIn.safeParse({ name: "x", category: "wedding", fp: { ...fp, trans: { teleport: 1 } } }).success).toBe(false);
    expect(SaveIn.safeParse({ name: "x", category: "wedding", fp: { ...fp, medianBeats: 999 } }).success).toBe(false);
    expect(SaveIn.safeParse({ name: "x", category: "wedding", fp: { ...fp, shotBeats: Array(301).fill(1) } }).success).toBe(false);
    expect(Object.keys(SaveIn.parse({ name: "x", category: "wedding", fp, video: "data:..." }))).not.toContain("video");
  });
});

// ---- storage, against a small in-memory database with the same per-user view as server/core/db.ts
import { vi } from "vitest";
const store = vi.hoisted(() => ({ user: "u1" as string | null, cols: new Map<string, Record<string, unknown>[]>(), seq: 0 }));
vi.mock("@/server/core/db", () => {
  const match = (d: Record<string, unknown>, f: Record<string, unknown>) => Object.entries(f).every(([k, v]) => v && typeof v === "object" && "$in" in (v as object) ? ((v as { $in: unknown[] }).$in).includes(d[k]) : String(d[k]) === String(v));
  const col = (name: string, owner: string | null) => {
    const all = () => { if (!store.cols.has(name)) store.cols.set(name, []); return store.cols.get(name)!; };
    const scope = (f: Record<string, unknown> = {}) => (owner ? { ...f, ownerId: owner } : f);
    const cursor = (rows: Record<string, unknown>[]) => { let r = rows; const c = { sort(s: Record<string, number>) { const [k, dir] = Object.entries(s)[0]; r = [...r].sort((a, b) => (a[k] as number) > (b[k] as number) ? dir : -dir); return c; }, limit(n: number) { r = r.slice(0, n); return c; }, toArray: async () => r }; return c; };
    return {
      find: (f?: Record<string, unknown>) => cursor(all().filter((d) => match(d, scope(f)))),
      insertOne: async (d: Record<string, unknown>) => { const doc = { ...d, _id: "id" + ++store.seq, ...(owner ? { ownerId: owner } : {}) }; all().push(doc); return { insertedId: doc._id }; },
      insertMany: async (ds: Record<string, unknown>[]) => { for (const d of ds) all().push({ ...d, _id: "id" + ++store.seq, ...(owner ? { ownerId: owner } : {}) }); return {}; },
      findOne: async (f: Record<string, unknown>) => all().find((d) => match(d, scope(f))) ?? null,
      countDocuments: async (f: Record<string, unknown> = {}) => all().filter((d) => match(d, scope(f))).length,
      updateOne: async (f: Record<string, unknown>, u: { $setOnInsert: Record<string, unknown> }, o?: { upsert?: boolean }) => {
        if (all().some((d) => match(d, scope(f))) || !o?.upsert) return {}; all().push({ ...u.$setOnInsert, _id: "id" + ++store.seq }); return {}; },
      deleteOne: async (f: Record<string, unknown>) => { const a = all(), i = a.findIndex((d) => match(d, scope(f))); if (i >= 0) a.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
      aggregate: (p: Record<string, Record<string, unknown>>[]) => { const m = p[0].$match ?? {}; const rows = all().filter((d) => match(d, owner ? { ...m, ownerId: owner } : m)); const g = new Map<string, number>(); for (const d of rows) g.set(String(d.category), (g.get(String(d.category)) ?? 0) + 1); return { toArray: async () => [...g].map(([k, n]) => ({ _id: k, n })) }; },
    };
  };
  return { db: async () => ({ collection: (n: string) => col(n, store.user) }), mainDb: async () => ({ collection: (n: string) => col(n, null) }), parseId: (id: string) => id };
});

vi.mock("@/server/core/auth", () => ({ currentUser: () => store.user }));

describe("storage", () => {
  it("keeps mine private, lets shared ones teach everyone, and learns from corrections", async () => {
    const { saveStyle, listStyles, learnedStyle, recordEdits, deleteStyle } = await import("../../src/server/studio/styles");
    store.user = "alice"; for (let k = 0; k < 4; k++) await saveStyle(SaveIn.parse({ name: `a${k}`, category: "wedding", shared: k < 2, fp: wedding() }));
    store.user = "bob"; await saveStyle(SaveIn.parse({ name: "b0", category: "wedding", fp: wedding() }));
    const bob = await listStyles();
    expect(bob.mine.map((s) => s.name)).toEqual(["b0"]);                         // bob sees only his own
    expect(bob.categories.wedding).toEqual({ mine: 1, shared: 2 });              // and that alice shared 2
    expect((await learnedStyle("wedding", "mine")).n).toBe(1);
    expect((await learnedStyle("wedding", "all")).n).toBe(3);                    // his + alice's shared, not her private ones
    const before = (await learnedStyle("wedding", "all")).fp!;
    await recordEdits({ category: "wedding", edits: Array.from({ length: 6 }, () => ({ type: "cut" as const, field: "tr" as const, from: "dissolve", to: "flash" })) });
    const after = await learnedStyle("wedding", "all");
    expect(after.corrections).toBe(6); expect(after.fp!.trans.flash ?? 0).toBeGreaterThan(before.trans.flash ?? 0);
    store.user = "alice"; expect((await learnedStyle("wedding", "all")).corrections).toBe(0);   // bob's taste stays his
    const aliceIds = (await listStyles()).mine.map((s) => s.id);
    store.user = "bob"; await expect(deleteStyle(aliceIds[0])).rejects.toThrow();                // cannot delete hers
    store.user = "alice"; await deleteStyle(aliceIds[0]); expect((await listStyles()).mine).toHaveLength(3);
    await expect(learnedStyle("cars", "all")).rejects.toThrow();
  });
});

describe("Reels from creators wait for the administrator", () => {
  // (a kind without the app's own seed Reels, so the counts are only the creators')
  it("a copied Reel teaches nothing until the administrator uses it under a kind; removing drops it", async () => {
    const { suggestStyle, listSuggestions, approveSuggestion, removeSuggestion, learnedStyle } = await import("../../src/server/studio/styles");
    store.cols.clear();
    store.user = "carol"; const fp = dance();
    await suggestStyle({ name: "trend 1", fp }); await suggestStyle({ name: "trend 1 again", fp });   // the same Reel twice: kept once
    await suggestStyle({ name: "trend 2", fp: dance() });
    expect((await learnedStyle("fitness", "all")).n).toBe(0);                     // waiting: teaches nothing
    store.user = "admin"; const list = await listSuggestions();
    expect(list.total).toBe(2); expect(list.items.map((s) => s.name).sort()).toEqual(["trend 1", "trend 2"]);
    const one = list.items.find((s) => s.name === "trend 1")!, two = list.items.find((s) => s.name === "trend 2")!;
    await approveSuggestion({ id: one.id, category: "fitness" });
    await removeSuggestion(two.id);
    expect((await listSuggestions()).total).toBe(0);
    store.user = "dave"; expect((await learnedStyle("fitness", "all")).n).toBe(1);  // used: it teaches everyone's styles
    await expect(approveSuggestion({ id: one.id, category: "fitness" })).rejects.toThrow();
  });
  it("a Reel a creator made and saved waits the same way, marked as made", async () => {
    const { suggestStyle, listSuggestions, learnedStyle } = await import("../../src/server/studio/styles");
    store.cols.clear();
    store.user = "carol"; await suggestStyle({ name: "my reel", fp: dance(), from: "made" }); await suggestStyle({ name: "copied", fp: dance() });
    expect((await learnedStyle("fitness", "all")).n).toBe(0);
    store.user = "admin"; const by = Object.fromEntries((await listSuggestions()).items.map((s) => [s.name, s.from]));
    expect(by).toEqual({ "my reel": "made", copied: "copy" });
  });
});
