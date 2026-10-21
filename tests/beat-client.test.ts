import { afterEach, describe, expect, it, vi } from "vitest";

/** The on-device beat tracker's worker on an iPhone: closed once it owes nothing more (its memory never shrinks), but not
 * while a second request (a second song picked meanwhile) still waits on it: that one would never be answered. */
type Msg = { id: number };
class FakeWorker {
  static all: FakeWorker[] = [];
  sent: Msg[] = []; terminated = false; private on = new Map<string, Set<(e: unknown) => void>>();
  constructor() { FakeWorker.all.push(this); }
  addEventListener(t: string, f: (e: unknown) => void) { if (!this.on.has(t)) this.on.set(t, new Set()); this.on.get(t)!.add(f); }
  removeEventListener(t: string, f: (e: unknown) => void) { this.on.get(t)?.delete(f); }
  postMessage(m: Msg) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  answer(id: number) { if (this.terminated) return; for (const f of [...(this.on.get("message") ?? [])]) f({ data: { id, type: "done", result: { beats: [1], downbeats: [1] }, ms: {} } }); }
}
const ua = (s: string) => Object.defineProperty(navigator, "userAgent", { value: s, configurable: true });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const song = () => new Float32Array(22050);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the beat tracker's worker", () => {
  afterEach(() => { FakeWorker.all = []; vi.resetModules(); vi.unstubAllGlobals(); });
  it("iPhone: two songs in a row are both answered; the worker is closed after the last", async () => {
    vi.stubGlobal("Worker", FakeWorker); ua(IPHONE);
    const { beatThisOnDevice } = await import("@/lib/beatThis/client");
    const a = beatThisOnDevice(song(), 22050), b = beatThisOnDevice(song(), 22050);
    await tick(); await tick();
    const w = FakeWorker.all[0]; expect(FakeWorker.all).toHaveLength(1); expect(w.sent).toHaveLength(2);
    w.answer(w.sent[0].id); await a;
    expect(w.terminated).toBe(false);          // the second song still waits on it
    w.answer(w.sent[1].id);
    await expect(b).resolves.toMatchObject({ beats: [1] });
    expect(w.terminated).toBe(true);           // nothing more owed: its memory goes
    beatThisOnDevice(song(), 22050); await tick(); await tick();
    expect(FakeWorker.all).toHaveLength(2);    // the next song gets a new worker
  });
  it("Android: the worker stays, as before", async () => {
    vi.stubGlobal("Worker", FakeWorker); ua(ANDROID);
    const { beatThisOnDevice } = await import("@/lib/beatThis/client");
    const a = beatThisOnDevice(song(), 22050); await tick(); await tick();
    const w = FakeWorker.all[0]; w.answer(w.sent[0].id); await a;
    expect(w.terminated).toBe(false);
  });
});
