import { afterEach, describe, expect, it, vi } from "vitest";
import { isReclaimed, nap, titleDone, titleProgress, whenVisible } from "@/lib/background";

/** Work in the background: it waits for the page to come back, shows its progress in the tab's title while hidden. */
let hidden = false;
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
const setHidden = (h: boolean) => { hidden = h; document.dispatchEvent(new Event("visibilitychange")); };
afterEach(() => { setHidden(false); vi.useRealTimers(); });

describe("background work", () => {
  it("waits for the page to come back, at once when it is visible", async () => {
    await expect(whenVisible()).resolves.toBeUndefined();
    setHidden(true);
    let back = false; const w = whenVisible().then(() => { back = true; });
    await Promise.resolve(); expect(back).toBe(false);
    setHidden(false); await w; expect(back).toBe(true);
  });
  it("a pause ends early when the page comes back", async () => {
    setHidden(true);
    const t0 = Date.now(), p = nap(10_000);
    setTimeout(() => setHidden(false), 20);
    await p; expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("knows a decoder the browser took back", () => {
    expect(isReclaimed(new DOMException("Codec reclaimed due to inactivity.", "QuotaExceededError"))).toBe(true);
    expect(isReclaimed(new Error("Encoding failed"))).toBe(false);
  });
  it("shows progress in the title only while hidden, and puts the title back", () => {
    document.title = "Shubix";
    titleProgress("export", "Exporting your Reel", 0.45);
    expect(document.title).toBe("Shubix");
    setHidden(true);
    expect(document.title).toBe("(45%) Exporting your Reel · Shubix");
    titleDone("export");
    expect(document.title).toBe("Shubix");
  });
});
