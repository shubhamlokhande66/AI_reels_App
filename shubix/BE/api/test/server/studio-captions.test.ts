// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/ai/transcribe", () => ({
  transcribe: vi.fn(async (_f: string, _s: number, d: number, _p: unknown, lang: string) => [
    { text: " नमस्कार ", start: 0.5, end: 0.9 }, { text: "", start: 1, end: 1.2 }, { text: "world\u0007", start: 2, end: null },
    { text: `lang:${lang || "auto"}`, start: d + 5, end: d + 6 }, { text: "early", start: -1, end: 0.2 },
  ]),
}));
import { captionSong, checkWav, cleanWords, LIMITS } from "../../src/server/studio/captions";

/** Fast Studio captions: the WAV the phone sends is checked, the words that come back are bounded. */
function wav(seconds: number, sr = 16000, ch = 1, bits = 16) {
  const n = Math.round(seconds * sr) * ch * (bits / 8), b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * ch * bits / 8, 28); b.writeUInt16LE(ch * bits / 8, 32); b.writeUInt16LE(bits, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  return b;
}

describe("the audio", () => {
  it("accepts 16 kHz mono 16-bit and gives its length", () => { expect(checkWav(wav(12.5))).toBeCloseTo(12.5, 3); });
  it("refuses other formats, empty and too long audio", () => {
    expect(() => checkWav(wav(5, 44100))).toThrow(/16 kHz/);
    expect(() => checkWav(wav(5, 16000, 2))).toThrow(/mono/);
    expect(() => checkWav(Buffer.from("not a wav at all, definitely not a wav file here"))).toThrow(/WAV/);
    expect(() => checkWav(wav(0))).toThrow();
    expect(() => checkWav(Buffer.alloc(LIMITS.bytes + 1))).toThrow(/at most/);
  });
});

describe("the words", () => {
  it("are trimmed, kept inside the song, in order, and never empty", () => {
    const w = cleanWords([{ text: "b", start: 3, end: 3.4 }, { text: "  a ", start: 1, end: 9 }, { text: "", start: 2, end: 2.1 }, { text: "x", start: Number.NaN, end: 1 }, { text: "late", start: 50, end: 60 }], 10);
    expect(w).toEqual([{ text: "a", start: 1, end: 4 }, { text: "b", start: 3, end: 3.4 }, { text: "late", start: 10, end: 10 }]);
  });
  it("keeps Devanagari exactly", () => {
    expect(cleanWords([{ text: "बाप्पा", start: 0, end: 0.5 }], 5)[0].text).toBe("बाप्पा");
  });
});

describe("a song", () => {
  it("is transcribed in the language asked for, words cleaned", async () => {
    const r = await captionSong(wav(8), "mr");
    expect(r.language).toBe("mr");
    expect(r.words.map((w) => w.text)).toEqual(["early", "नमस्कार", "world", "lang:mr"]);
    expect(r.words.every((w) => w.start >= 0 && w.end <= 8)).toBe(true);
    expect((await captionSong(wav(4), "xx")).language).toBe("auto");   // unknown: detected
  });
});
