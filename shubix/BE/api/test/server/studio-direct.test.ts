// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ManagedProvider } from "../../src/server/ai";
import { CHUNK, chunks, cleanActions, cleanMove, cleanTexts, direct, DirectIn, directPatch, directVariants, LIMITS, MAX_VARIANTS, pace, PaceIn, pacePrompt, parsePace, parsePlan, prompt, variantsPrompt } from "../../src/server/studio/direct";
import { shotCacheKey } from "../../src/server/studio/rankShots";

/** Fast Studio's AI director: the request is bounded, and the plan can only name what the phone offered. */
const cand = (id: string, extra = {}) => ({ id, clip: "c1", at: 1.5, score: 1.2, note: "dancer spins", roles: ["action"], motion: "high", people: true, camera: "pans left", ...extra });
const req = (n = 3) => DirectIn.parse({
  mode: "auto", duration: 20, bpm: 120, hook: "WAIT FOR IT", clips: [{ alias: "c1", summary: "rooftop dance", mood: "energetic" }],
  budget: { whip: 2 },
  slots: Array.from({ length: n }, (_, i) => ({ i, t: i * 2, len: 2, type: i === 1 ? "drop" : "cut", beats: 2, candidates: [cand(`${i}a`), cand(`${i}b`, { clip: "c2" })] })),
});

function fake(answer: unknown) {
  const calls: string[] = [];
  const p = { name: "fake", model: "fake-text", visionModel: "",
    async structured(_s: string, user: string, schema: { parse: (v: unknown) => unknown }) { calls.push(user); return schema.parse(answer); } };
  return { p: p as unknown as ManagedProvider, calls };
}

describe("vision shot cache fingerprint", () => {
  const provider = (model = "text", visionModel = "vision") => ({ name: "test-provider", model, visionModel }) as ManagedProvider;
  const clip = (extra = {}) => ({ id: "clip-1", name: "dance", frames: [{ t: 1.25, image: "/9j/4AAQSkZJRgABAQAAAQABAAD/" }], ...extra });
  it("is deterministic for identical inputs and changes when model or frame identity changes", () => {
    const base = shotCacheKey(provider(), clip());
    expect(shotCacheKey(provider(), clip())).toBe(base);
    expect(shotCacheKey(provider("other"), clip())).not.toBe(base);
    expect(shotCacheKey(provider("text", "other-vision"), clip())).not.toBe(base);
    expect(shotCacheKey(provider(), clip({ name: "wedding" }))).not.toBe(base);
    expect(shotCacheKey(provider(), clip({ frames: [{ t: 2, image: "/9j/4AAQSkZJRgABAQAAAQABAAD/" }] }))).not.toBe(base);
    expect(shotCacheKey(provider(), clip({ frames: [{ t: 1.25, image: "/9j/4AAQSkZJRgABAQAAAQABBBB/" }] }))).not.toBe(base);
  });
});
describe("request limits", () => {
  it("accepts a normal plan request", () => { expect(req(40).slots).toHaveLength(40); });
  it("rejects too many cuts or candidates, bad ids and unknown cut types", () => {
    const base = req(1);
    expect(DirectIn.safeParse({ ...base, slots: Array.from({ length: LIMITS.slots + 1 }, (_, i) => ({ ...base.slots[0], i: i % LIMITS.slots })) }).success).toBe(false);
    expect(DirectIn.safeParse({ ...base, slots: [{ ...base.slots[0], candidates: [cand("0a"), cand("0b"), cand("0c"), cand("0a")] }] }).success).toBe(false);
    expect(DirectIn.safeParse({ ...base, slots: [{ ...base.slots[0], candidates: [cand("x; drop table")] }] }).success).toBe(false);
    expect(DirectIn.safeParse({ ...base, slots: [{ ...base.slots[0], type: "boom" }] }).success).toBe(false);
  });
  it("puts every cut and its candidates in the prompt, with the rules", () => {
    const text = prompt(req(3));
    expect(text).toContain('"id":"2b"');
    expect(text).toContain("Style: auto");
    expect(text).toContain("hook");
    expect(text).not.toContain('{"whip":2}');   // no budget: the AI uses any tool as often as it likes
    expect(text).toContain("boxgrow"); expect(text).toContain("no limits on style");
    const fresh = prompt(DirectIn.parse({ ...req(3), recent: ["boxgrow", "flash", "speed 0.5×"] }));
    expect(fresh).toContain("Used in this creator's last Reels (make this one feel different: other tools, other combinations): boxgrow, flash, speed 0.5×.");
  });
});

describe("the plan is bounded", () => {
  it("keeps valid AI choices and safely completes invalid or omitted cuts", () => {
    const d = req(3);
    const out = parsePlan(d, {
      story: "Rooftop build-up to a spinning drop",
      slots: [
        { i: 0, shot: "0B", transition: "Hard", effect: "hook", speed: "normal", why: "strongest opening" },
        { i: 1, shot: "1c", transition: "teleport", effect: "zoomburst", speed: "warp", why: "" },   // 1c was not offered
        { i: 1, shot: "1a", transition: "flash", effect: "none", speed: "normal", why: "repeat" },   // second answer for 1: ignored
        { i: 7, shot: "7a", transition: "hard", effect: "none", speed: "normal", why: "no such cut" },
        { i: 2, shot: "2a", transition: "whip", effect: "pan", speed: "ramp", why: "x".repeat(200) },
      ],
    });
    expect(out.slots.map((s) => s.i)).toEqual([0, 1, 2]);
    expect(out.slots[0]).toMatchObject({ shot: "0b", transition: "hard", effect: "hook", speed: "normal" });
    expect(out.slots[1]).toMatchObject({ shot: "1a", transition: "hard", effect: "zoomburst", speed: "normal" });
    expect(out.slots[2].why.length).toBeLessThanOrEqual(60);
    expect(out.story).toBe("Rooftop build-up to a spinning drop");
  });
  it("completes a completely missing or unusable AI answer with deterministic safe choices", () => {
    const d = req(3);
    const out = parsePlan(d, { story: "", slots: [{ i: 9, shot: "9a", transition: "teleport", effect: "explode", speed: "warp", why: "" }] });
    expect(out.slots).toHaveLength(3);
    expect(out.slots.map((s) => s.i)).toEqual([0, 1, 2]);
    expect(out.slots[0]).toMatchObject({ shot: "0a", transition: "hard", effect: "none", speed: "normal" });
    expect(out.slots.every((s) => s.shot && s.transition && s.effect && s.speed)).toBe(true);
  });
  it("marks the cuts the AI left without a usable answer, so the phone keeps its own choice there", () => {
    const d = req(3);
    const out = parsePlan(d, { story: "", slots: [{ i: 1, shot: "1b", transition: "whip", effect: "punch", speed: "normal", why: "drop" }, { i: 2, shot: "nope", transition: "teleport", effect: "explode", speed: "x", why: "" }] });
    expect(out.slots.map((s) => !!s.auto)).toEqual([true, false, true]);
  });
  it("an AI answer covering half the Reel or less fails (the phone edits, the credits come back)", async () => {
    const half = fake({ story: "", slots: [{ i: 0, shot: "0a", transition: "hard", effect: "hook", speed: "normal", why: "" }] });
    await expect(direct(req(3), half.p)).rejects.toThrow(/answered only 1 of 3 cuts/);
    const most = fake({ story: "s", slots: [0, 1].map((i) => ({ i, shot: `${i}a`, transition: "hard", effect: "punch", speed: "normal", why: "" })) });
    const res = await direct(req(3), most.p);
    expect(res.auto).toBe(1);
    expect(res.slots[2].auto).toBe(true);
  });
  it("uses role-aware fallback shots and avoids adjacent source-clip repetition", () => {
    const d = req(3);
    d.slots[0].candidates[0].roles = ["calm"];
    d.slots[0].candidates[1].roles = ["hook"];
    d.slots[1].candidates[0].clip = "c1";
    d.slots[1].candidates[1].clip = "c2";
    d.slots[2].candidates[0].clip = "c1";
    d.slots[2].candidates[1].clip = "c2";
    const out = parsePlan(d, { story: "", slots: [] });
    expect(out.slots[0].shot).toBe("0b");
    expect(out.slots[1].shot).toBe("1a");
    expect(out.slots[2].shot).toBe("2b");
  });
  it("keeps Ask Shubix patches limited to the cuts the creator asked to change", async () => {
    const d = DirectIn.parse({ ...req(3), patch: { ask: "change the second cut", current: [
      { i: 0, clip: "c1", at: 0, transition: "hard", effect: "hook", speed: "normal" },
      { i: 1, clip: "c1", at: 2, transition: "hard", effect: "none", speed: "normal" },
      { i: 2, clip: "c1", at: 4, transition: "hard", effect: "none", speed: "normal" },
    ] } });
    const { p } = fake({ slots: [{ i: 1, shot: "1b", transition: "flash", effect: "none", speed: "normal" }], story: "second cut changed" });
    const out = await directPatch(d, p);
    expect(out.slots.map((s) => s.i)).toEqual([1]);
  });
  it("asks the model once and returns the cleaned plan", async () => {
    const { p, calls } = fake({ slots: [{ i: 0, shot: "0a" }, { i: 1, shot: "1b", transition: "flash", effect: "zoomburst" }], story: "s" });
    const res = await direct(req(2), p);
    expect(calls).toHaveLength(1);
    expect(res.slots).toEqual([
      { i: 0, shot: "0a", transition: "hard", effect: "none", speed: "normal", keys: [], move: [], why: "" },
      { i: 1, shot: "1b", transition: "flash", effect: "zoomburst", speed: "normal", keys: [], move: [], why: "" },
    ]);
  });
});

/** The AI is the brain: it hears the music map, places keyframes on the hits, and chooses the pace of each section. */
const music = { loud: 0.8, trend: "rising" as const, bass: 0.6, drums: 0.9, voice: 0.3, vox: "goes up" as const,
  hits: [{ at: 0.4, k: "dhol" as const, p: 3 }, { at: 1.2, k: "snare" as const, p: 2 }], toDrop: 2 };
const withMusic = () => { const d = req(3); d.slots[0].music = music; return d; };

describe("the music map and keyframes", () => {
  it("sends each cut's music to the AI and explains how to read it", () => {
    const text = prompt(withMusic(), "on drops they choose transition \"flash\" (3x)");
    expect(text).toContain('"music":{"loud":0.8,"trend":"rising"');
    expect(text).toContain('"k":"dhol"');
    expect(text).toContain("dhol (dhol/tom");
    expect(text).toContain("Keyframes");
    expect(text).toContain("creator's taste");
  });
  it("rejects a music map with unknown hit kinds or levels out of range", () => {
    const d = req(1);
    expect(DirectIn.safeParse({ ...d, slots: [{ ...d.slots[0], music: { ...music, hits: [{ at: 0.4, k: "gong", p: 1 }] } }] }).success).toBe(false);
    expect(DirectIn.safeParse({ ...d, slots: [{ ...d.slots[0], music: { ...music, loud: 4 } }] }).success).toBe(false);
  });
  it("keeps keyframes inside the shot, on the nearest hit, known kinds only, at most four", () => {
    const out = parsePlan(withMusic(), { story: "", slots: [{ i: 0, shot: "0a", transition: "hard", effect: "hook", speed: "normal", why: "",
      keys: [{ at: 0.45, do: "Punch" }, { at: 1.15, do: "shake" }, { at: 0.5, do: "flash" }, { at: 1.9, do: "pulse" }, { at: 3, do: "punch" }, { at: 0.8, do: "explode" }] }] });
    expect(out.slots[0].keys).toEqual([{ at: 0.4, do: "punch" }, { at: 1.2, do: "shake" }, { at: 1.9, do: "pulse" }]);   // 0.5 lands on the 0.4 hit (taken), 3 s is past the shot
  });
});

describe("long Reels", () => {
  it("keeps prompt overhead low by planning up to 30 cuts per model call", () => {
    expect(CHUNK).toBe(30);
    expect(Math.ceil(LIMITS.slots / CHUNK)).toBe(5); // 150 cuts: 5 calls instead of 8 at 20 cuts per call
  });
  it("are planned in parts at the same time, each part told where it sits", async () => {
    const d = req(LIMITS.slots);
    const parts = Math.ceil(LIMITS.slots / CHUNK);
    expect(chunks(d).map((c) => c.slots.length)).toEqual(Array.from({ length: parts }, (_, k) => Math.min(CHUNK, LIMITS.slots - k * CHUNK)));
    expect(prompt(chunks(d)[1])).toContain(`cuts ${CHUNK}-${2 * CHUNK - 1} of a longer Reel`);
    const calls: string[] = [];
    const p = { name: "fake", model: "m", visionModel: "", async structured(_s: string, user: string, schema: { parse: (v: unknown) => unknown }) {
      calls.push(user); const first = Number(/"i":(\d+)/.exec(user.split("Cuts (fixed")[1])![1]);
      const n = Math.min(CHUNK, LIMITS.slots - first);   // an answer for every cut of its part
      return schema.parse({ slots: Array.from({ length: n }, (_, k) => ({ i: first + k, shot: `${first + k}a` })), story: calls.length === 1 ? "arc" : "" }); } };
    const res = await direct(d, p as unknown as ManagedProvider);
    expect(calls).toHaveLength(parts);   // all asked at the same time
    expect(res.slots.map((s) => s.i)).toEqual(Array.from({ length: LIMITS.slots }, (_, i) => i));
  });
});

describe("pace", () => {
  const sec = (i: number, extra = {}) => ({ i, t: i * 8, len: 8, beats: 16, starts: i ? "drop" : "start", loud: 0.5, trend: "steady", bass: 0.5, drums: 0.5, voice: 0.5, hitRate: 1, now: 2, ...extra });
  const pin = (mode = "auto") => PaceIn.parse({ mode, duration: 24, bpm: 120, footage: 60, clips: 6, sections: [sec(0), sec(1), sec(2, { starts: "break" })] });
  it("keeps one pace per known section, the nearest of 1, 2, 4, 8 beats in any style (the style is no limit)", () => {
    const out = parsePace(pin("smooth"), { story: "builds", sections: [{ i: 0, every: 1, why: "" }, { i: 1, every: 3, why: "drop" }, { i: 1, every: 8, why: "dup" }, { i: 9, every: 2, why: "" }] });
    expect(out.sections).toEqual([{ i: 0, every: 1, why: "" }, { i: 1, every: 2, why: "drop" }]);
    expect(parsePace(pin("fast"), { story: "", sections: [{ i: 2, every: 8, why: "" }] }).sections[0].every).toBe(8);
    // the trends of the learned kinds reach both prompts, after the creator's taste
    const tr = "WHAT TRENDING REELS OF EACH KIND DO (test):\n- car (8 Reels): a cut every 1 beat";
    expect(pacePrompt(pin("auto"), "", tr)).toContain("- car (8 Reels)");
    expect(prompt(req(), "", tr)).toContain("WHAT TRENDING REELS OF EACH KIND DO");
    expect(prompt(req(), "")).not.toContain("WHAT TRENDING");
    // a cut on every hit and a flicker are the AI's own choices too (the car and sports Reels' beat edits)
    const w = parsePace(pin("auto"), { story: "", sections: [{ i: 0, every: "hits", why: "dense drums" }, { i: 1, every: "Flicker", why: "riser" }, { i: 2, every: "fast", why: "?" }] }).sections;
    expect(w.map((x) => x.every)).toEqual(["hits", "flicker"]);
  });
  it("refuses an answer with no usable section, and asks the model once", async () => {
    expect(() => parsePace(pin(), { story: "", sections: [{ i: 7, every: 2, why: "" }] })).toThrow();
    const { p, calls } = fake({ sections: [{ i: 0, every: 1 }, { i: 2, every: 4 }], story: "calm end" });
    const res = await pace(pin(), p);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('"starts":"break"');
    expect(res.sections.map((s) => s.every)).toEqual([1, 4]);
  });
});

/** Copy a Reel through the AI: the reference shot by shot, the AI's camera keyframes kept safe, the new shapes. */
const reference = { name: "wedding.mp4", medianBeats: 2, hookBeats: 4, onBeat: 0.9, energy: "rising", zoomShare: 0.4, trans: { hard: 0.5, flash: 0.3, heart: 0.2 },
  moments: [
    { beats: 4, sec: 2, tr: "start", zoom: "in", move: [{ f: 0, s: 1, x: 0, y: 0, r: 0 }, { f: 1, s: 1.2, x: 0.02, y: 0, r: 0 }], ease: "outCubic", loud: 0.3, trend: "rising" },
    { beats: 2, sec: 1, tr: "flash", zoom: "none", drop: true, hit: "dhol", loud: 1, shake: true },
    { beats: 2, sec: 1, tr: "heart", zoom: "none", freeze: 0.4, voice: 0.8 },
  ] };
describe("copy a Reel", () => {
  it("accepts the reference and puts it, shot by shot, in both prompts", () => {
    const d = DirectIn.parse({ ...req(2), mode: "copy", reference });
    const text = prompt(d);
    expect(text).toContain('"wedding.mp4": a cut every 2 beats (hook 4 beats), 90% of cuts on the beat');
    expect(text).toContain('"tr":"heart"');
    expect(text).toContain("COPY THE REFERENCE");
    expect(pacePrompt(PaceIn.parse({ mode: "copy", duration: 20, bpm: 120, footage: 30, clips: 3, reference,
      sections: [{ i: 0, t: 0, len: 20, beats: 40, starts: "start", loud: 0.5, trend: "steady", bass: 0.5, drums: 0.5, voice: 0.5, hitRate: 1, now: 2 }] }))).toContain("copy its pace");
  });
  it("refuses a reference move out of range or an unknown transition kind", () => {
    expect(DirectIn.safeParse({ ...req(1), reference: { ...reference, moments: [{ ...reference.moments[0], move: [{ f: 0, s: 9, x: 0, y: 0, r: 0 }] }] } }).success).toBe(false);
    expect(DirectIn.safeParse({ ...req(1), reference: { ...reference, moments: [{ ...reference.moments[1], tr: "portal" }] } }).success).toBe(false);
  });
});
describe("the AI's camera keyframes", () => {
  it("are as free as the creator's own keyframes: inside the shot, zoom 0.1-4, slide -1..1, turn +-360, a known ease", () => {
    expect(cleanMove([{ at: 0.5, s: 3, x: 0.9, y: -1, r: 40, ez: "warp" }, { at: 1.2, s: 1, x: 0, y: 0, r: 0, ez: "lin" }, { at: 1, s: 1.1, x: 0, y: 0, r: 0, ez: "outExpo" }]))
      .toEqual([{ at: 0, s: 1, x: 0, y: 0, r: 0, ez: "inOut" }, { at: 0.5, s: 3, x: 0.9, y: -1, r: 40, ez: "inOut" }, { at: 1, s: 1.1, x: 0, y: 0, r: 0, ez: "outExpo" }]);
    expect(cleanMove([{ at: 0, s: 10, x: 5, y: -5, r: 900, ez: "lin" }, { at: 1, s: 0.01, x: 0, y: 0, r: -900, ez: "lin" }]))
      .toEqual([{ at: 0, s: 4, x: 1, y: -1, r: 360, ez: "lin" }, { at: 1, s: 0.1, x: 0, y: 0, r: -360, ez: "lin" }]);
  });
  it("drop a 'move' that does not move", () => {
    expect(cleanMove([{ at: 0, s: 1, x: 0, y: 0, r: 0, ez: "lin" }, { at: 1, s: 1, x: 0, y: 0, r: 0, ez: "lin" }])).toEqual([]);
  });
  it("come back from the plan, with the new shape transitions", () => {
    const out = parsePlan(req(2), { story: "", slots: [{ i: 1, shot: "1a", transition: "Heart", effect: "none", speed: "normal", why: "",
      move: [{ at: 0, s: 1.3, x: 0, y: 0, r: 0, ez: "lin" }, { at: 0.25, s: 1, x: 0, y: 0, r: 0, ez: "outExpo" }] }] });
    expect(out.slots[1].transition).toBe("heart");
    expect(out.slots[1].move).toHaveLength(2);
  });
});

/** New mix: other plans for the same cuts in one call; the pace asked once for the whole song. */
describe("New mix", () => {
  it("asks once for several different plans and checks each like a plan", async () => {
    const { p, calls } = fake({ plans: [
      { slots: [{ i: 0, shot: "0b" }, { i: 1, shot: "1a", transition: "whip" }], story: "calmer" },
      { slots: [{ i: 0, shot: "zz" }, { i: 1, shot: "1b", transition: "nope", effect: "shake" }], story: "harder" },
      { slots: [{ i: 7, shot: "7a" }], story: "unusable" },
    ] });
    const res = await directVariants({ ...req(2), variants: 3 }, p);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("make 3 DIFFERENT plans");
    expect(res.plans).toHaveLength(3); // incomplete and unusable plans are safely completed
    expect(res.plans[0].slots.map((s) => s.shot)).toEqual(["0b", "1a"]);
    expect(res.plans[1].slots[0].shot).toBe("0a"); // invalid shot falls back to the best offered moment
    expect(res.plans[1].slots[1]).toMatchObject({ shot: "1b", transition: "hard", effect: "shake", speed: "normal" });
    expect(res.plans[2].slots).toHaveLength(2); // even an answer with no offered cut gets a safe complete edit
  });
  it("asks for at most four, and long Reels in parts joined in order", async () => {
    expect(() => DirectIn.parse({ ...req(2), variants: MAX_VARIANTS + 1 })).toThrow();
    const n = CHUNK + 5, plan = (lo: number, hi: number) => ({ slots: Array.from({ length: hi - lo }, (_, k) => ({ i: lo + k, shot: `${lo + k}a` })) });
    const p = { name: "fake", model: "m", async structured(_s: string, user: string, schema: { parse: (v: unknown) => unknown }) {
      const first = user.includes(`These are cuts ${CHUNK}-`) ? CHUNK : 0, last = first ? n : CHUNK;
      return schema.parse({ plans: [plan(first, last), plan(first, last)] }); } } as unknown as Parameters<typeof directVariants>[1];
    const res = await directVariants({ ...req(n), variants: 2 }, p);
    expect(res.plans).toHaveLength(2);
    expect(res.plans[0].slots.map((s) => s.i)).toEqual(Array.from({ length: n }, (_, i) => i));
  });
  it("tells the AI the other plans are for the same cuts, without the plan's JSON", () => {
    const t = variantsPrompt({ ...req(2), variants: 4 });
    expect(t).toContain('"plans"');
    expect(t).not.toContain('Return JSON: {"slots"');
  });
  it("asks the pace for the whole song when the Reel uses a part of it", () => {
    const sec = { i: 0, t: 0, len: 8, beats: 16, starts: "start", loud: 0.5, trend: "steady", bass: 0.5, drums: 0.5, voice: 0.5, hitRate: 1, now: 2 };
    const whole = PaceIn.parse({ mode: "auto", duration: 180, reel: 30, bpm: 120, footage: 60, clips: 6, sections: [sec] });
    expect(pacePrompt(whole)).toContain("uses a 30.0 s part of this song");
    expect(pacePrompt({ ...whole, reel: undefined })).not.toContain("part of this song");
  });
});

describe("every tool is open to the AI", () => {
  it("takes the beat shapes and each shot's own look, keeping only known fields in range", () => {
    const d = DirectIn.parse(req(3));
    const out = parsePlan(d, { story: "", slots: [
      { i: 0, shot: "0a", transition: "hard", effect: "hook", speed: "normal", why: "" },
      { i: 1, shot: "1a", transition: "heart", effect: "boxgrow", speed: "normal", why: "", clip: { rot: 92, fh: true, fit: true, bg: "#112233", bd: 3, sat: -1, warm: 0.4, fout: 9, zoom: 7, evil: "x" } },
      { i: 2, shot: "2a", transition: "star", effect: "kaleido", speed: "fast", why: "", clip: { bg: "blur", bri: "lots" } },
    ] });
    expect(out.slots[1]).toMatchObject({ effect: "boxgrow", transition: "heart", clip: { rot: 90, fh: true, fit: true, bg: "color", bgc: "#112233", bd: 1, bdc: "#FFFFFF", sat: -1, warm: 0.4, fout: 1.5 } });
    expect(out.slots[1].clip).toMatchObject({ zoom: 3 });   // zoom is a clip tool: kept, in its range
    expect(out.slots[1].clip).not.toHaveProperty("evil");
    expect(out.slots[2].effect).toBe("kaleido");
    expect(out.slots[2]).not.toHaveProperty("clip");   // a background without "fit" and a word for a number: nothing usable
  });
});

describe("the creator's chat (Ask Shubix)", () => {
  const sec = [{ i: 0, t: 0, len: 20, beats: 40, starts: "start", loud: 0.5, trend: "steady", bass: 0.5, drums: 0.5, voice: 0.5, hitRate: 1, now: 2 }];
  it("puts what the creator asked in both prompts, ahead of the rules, and nothing when they asked nothing", () => {
    const d = DirectIn.parse({ ...req(2), wish: "zoom on the drop · start with my face" });
    expect(prompt(d)).toContain('THE CREATOR ASKED FOR THIS');
    expect(prompt(d)).toContain('"zoom on the drop · start with my face"');
    expect(variantsPrompt({ ...d, variants: 2 })).toContain("THE CREATOR ASKED FOR THIS");
    expect(pacePrompt(PaceIn.parse({ mode: "auto", duration: 20, bpm: 120, footage: 30, clips: 3, wish: "faster cuts", sections: sec }))).toContain('"faster cuts"');
    expect(prompt(req(2))).not.toContain("THE CREATOR ASKED");
  });
  it("keeps the wish short", () => {
    expect(() => DirectIn.parse({ ...req(1), wish: "x".repeat(801) })).toThrow();
  });
});

describe("Shubix AI as the editor: texts and other tools", () => {
  it("keeps a text with its keyframes and focus, made safe to draw", () => {
    const [t] = cleanTexts([{ text: " WELCOME ", start: 0, end: 2.5, x: 0.5, y: 0.4, size: 9, style: "CUTOUT", color: "#000000", anim: "pop", loop: "none", font: "", behind: false, track: false, focus: 0.64,
      keys: [{ at: 2, s: 40, x: 0, y: 0, r: 0, o: 1, ez: "in" }, { at: 0.5, s: 1, x: 0, y: 0, r: 0, o: 1, ez: "inOut" }] }]);
    expect(t).toMatchObject({ text: "WELCOME", style: "cutout", size: 3, focus: 0.64 });
    expect(t.keys.map((k) => [k.at, k.s, k.ez])).toEqual([[0.5, 1, "inOut"], [2, 40, "inOut"]]);
  });
  it("keeps a shot's mask, in range", () => {
    const out = parsePlan(req(2), { slots: [{ i: 0, shot: "0a", transition: "hard", effect: "none", speed: "normal", why: "", clip: { mk: { s: "heart", x: 2, y: 0.4, w: 0.5, h: 0.5, a: 400, f: 0.1, inv: true, c: "#ff0000" } } }, { i: 1, shot: "1a", transition: "hard", effect: "none", speed: "normal", why: "", clip: { mk: { s: "blob" } } }], story: "" });
    expect(out.slots[0].clip?.mk).toEqual({ s: "heart", x: 1, y: 0.4, w: 0.5, h: 0.5, a: 180, f: 0.1, inv: true, c: "#FF0000" });
    expect(out.slots[1].clip).toBeUndefined();
  });  it("keeps a shot's curves and HSL, in range", () => {
    const out = parsePlan(req(1), { slots: [{ i: 0, shot: "0a", transition: "hard", effect: "none", speed: "normal", why: "", clip: { cv: { m: [0, 0.2, 0.5, 0.8, 2], x: [1, 2, 3, 4, 5], r: [1] }, hsl: { blue: [0, 3, -0.2], pink: [1, 1, 1] } } }], story: "" });
    expect(out.slots[0].clip).toMatchObject({ cv: { m: [0, 0.2, 0.5, 0.8, 1] }, hsl: { blue: [0, 1, -0.2] } });
    expect(out.slots[0].clip?.cv).not.toHaveProperty("r"); expect(out.slots[0].clip?.hsl).not.toHaveProperty("pink");
  });
  it("keeps only the tools the studio has, in order", () => {
    const out = cleanActions([{ do: "LAYER", clip: "c2", start: 1 }, { do: "hack" }, { do: "look", name: "cine" }]);
    expect(out.map((a) => a.do)).toEqual(["layer", "look"]);
  });
  it("tells the AI about every tool", () => {
    const p = prompt(req(2));
    for (const w of ["TEXTS", "cutout", "OTHER TOOLS", '"do":"layer"', '"do":"captions"', '"actions"']) expect(p).toContain(w);
  });
});
