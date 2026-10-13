// @vitest-environment node
import { expect, it } from "vitest";
import { PyRandom } from "@/server/core/random";

it("is Python's random.Random", () => {
  expect(new PyRandom(0).random()).toBe(0.8444218515250481);
  expect(new PyRandom(42).random()).toBe(0.6394267984578837);
  const r = new PyRandom(7);
  expect(r.uniform(-0.03, 0.03)).toBeCloseTo(-0.03 + 0.06 * 0.32383276483316237, 12);
});
