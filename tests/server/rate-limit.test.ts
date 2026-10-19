import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, limit } from "@/server/core/rateLimit";

const req = (headers: Record<string, string>) => new Request("http://localhost/api/x", { headers });

describe("rate limit", () => {
  afterEach(() => vi.useRealTimers());

  it("lets tries through up to the limit, then answers 429 with when to try again", () => {
    for (let i = 0; i < 3; i++) limit("t:a", 3, 60_000);
    let err: unknown;
    try {
      limit("t:a", 3, 60_000);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect((err as { details: { retryAfter: number } }).details.retryAfter).toBeGreaterThan(0);
  });

  it("counts each key on its own", () => {
    for (let i = 0; i < 2; i++) limit("t:b", 2, 60_000);
    expect(() => limit("t:c", 2, 60_000)).not.toThrow();
    expect(() => limit("t:b", 2, 60_000)).toThrow();
  });

  it("starts again once the window is over", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 2; i++) limit("t:d", 2, 1000);
    expect(() => limit("t:d", 2, 1000)).toThrow();
    vi.advanceTimersByTime(1001);
    expect(() => limit("t:d", 2, 1000)).not.toThrow();
  });

  it("reads the visitor's address behind Cloudflare or a proxy", () => {
    expect(clientIp(req({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("local");
  });
});
