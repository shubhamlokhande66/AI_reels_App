// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ManagedProvider } from "@/server/ai";
import { CHUNK, chunks, cleanMove, direct, DirectIn, directVariants, LIMITS, MAX_VARIANTS, pace, PaceIn, pacePrompt, parsePace, parsePlan, prompt, variantsPrompt } from "@/server/studio/direct";

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
  it("keeps offered shots and known choices, nulls the rest, drops unknown or repeated cuts", () => {
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
    expect(out.slots[1]).toMatchObject({ shot: null, transition: null, effect: "zoomburst", speed: null });
    expect(out.slots[2].why.length).toBeLessThanOrEqual(60);
    expect(out.story).toBe("Rooftop build-up to a spinning drop");
  });
  it("refuses a plan with no usable cut", () => {
    expect(() => parsePlan(req(2), { story: "", slots: [{ i: 9, shot: "9a", transition: "hard", effect: "none", speed: "normal", why: "" }] })).toThrow();
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
  it("are planned in parts at the same time, each part told where it sits", async () => {
    const d = req(LIMITS.slots);
    const parts = Math.ceil(LIMITS.slots / CHUNK);
    expect(chunks(d).map((c) => c.slots.length)).toEqual(Array.from({ length: parts }, (_, k) => Math.min(CHUNK, LIMITS.slots - k * CHUNK)));
    expect(prompt(chunks(d)[1])).toContain(`cuts ${CHUNK}-${2 * CHUNK - 1} of a longer Reel`);
    const calls: string[] = [];
    const p = { name: "fake", model: "m", visionModel: "", async structured(_s: string, user: string, schema: { parse: (v: unknown) => unknown }) {
      calls.push(user); const first = Number(/"i":(\d+)/.exec(user.split("Cuts (fixed")[1])![1]);
      return schema.parse({ slots: [{ i: first, shot: `${first}a` }], story: calls.length === 1 ? "arc" : "" }); } };
    const res = await direct(d, p as unknown as ManagedProvider);
    expect(calls).toHaveLength(parts);   // all asked at the same time
    expect(res.slots.map((s) => s.i)).toEqual(Array.from({ length: parts }, (_, k) => k * CHUNK));
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
    expect(out.slots[0].transition).toBe("heart");
    expect(out.slots[0].move).toHaveLength(2);
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
    expect(res.plans).toHaveLength(2); // the plan with no usable cut is left out
    expect(res.plans[0].slots.map((s) => s.shot)).toEqual(["0b", "1a"]);
    expect(res.plans[1].slots[0].shot).toBeNull(); // not offered for that cut
    expect(res.plans[1].slots[1]).toMatchObject({ shot: "1b", transition: null, effect: "shake" });
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
    expect(out.slots[1].clip).not.toHaveProperty("zoom");
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
