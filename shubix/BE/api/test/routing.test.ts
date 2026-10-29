import { describe, expect, it } from "vitest";
import { compile, rank } from "../src/routing/route-table";

describe("route table", () => {
  it("turns folder names into patterns with params", () => {
    const r = compile("api/brands/[brandId]/logo");
    expect(r.keys).toEqual(["brandId"]);
    expect(r.re.exec("/api/brands/abc%20d/logo")?.[1]).toBe("abc%20d");
    expect(r.re.test("/api/brands/x/logo/more")).toBe(false);
  });
  it("puts a fixed segment before a param (like Next.js)", () => {
    expect(rank("api/studio/reels/complete") > rank("api/studio/reels/[id]")).toBe(true);
    const sorted = ["api/voices/[voiceId]", "api/voices/system"].sort((a, b) => (rank(a) > rank(b) ? -1 : 1));
    expect(sorted[0]).toBe("api/voices/system");
  });
});
