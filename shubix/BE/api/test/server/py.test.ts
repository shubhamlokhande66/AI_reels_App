// @vitest-environment node
import { describe, expect, it } from "vitest";
import { g, round } from "@shubix/core/engine/core/py";

describe("Python-compatible helpers", () => {
  it("round() matches Python, exact ties to even", () => {
    // [x, round(x, 3), round(x, 2), round(x, 0)] from CPython
    const cases = [[0.0625, 0.062, 0.06, 0.0], [0.125, 0.125, 0.12, 0.0], [2.675, 2.675, 2.67, 3.0], [5.8615, 5.862, 5.86, 6.0], [1.0005, 1.0, 1.0, 1.0],
      [0.5, 0.5, 0.5, 0.0], [1.5, 1.5, 1.5, 2.0], [2.5, 2.5, 2.5, 2.0], [-0.125, -0.125, -0.12, -0.0], [3.14159, 3.142, 3.14, 3.0], [7.000000000001, 7.0, 7.0, 7.0], [0.375, 0.375, 0.38, 0.0]];
    for (const [x, r3, r2, r0] of cases) expect([round(x, 3), round(x, 2), round(x, 0) + 0]).toEqual([r3, r2, r0 + 0]);
  });
  it("g() is Python's :g", () => {
    // from CPython f"{x:g}"
    const cases: [number, string][] = [[14.78125, "14.7812"], [10.03125, "10.0312"], [0.25, "0.25"], [4.0, "4"], [1234567.0, "1.23457e+06"], [0.0001, "0.0001"],
      [1e-05, "1e-05"], [-2.5, "-2.5"], [999999.5, "1e+06"], [1e-07, "1e-07"], [123456.5, "123456"], [0.1 + 0.2, "0.3"], [12.0, "12"], [-0.0, "-0"]];
    for (const [x, want] of cases) expect(g(x)).toBe(want);
  });
});
