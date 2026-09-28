import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiDirectorSection } from "@/components/ReelPlanPanel";
import type { AiDirectorLog } from "@/types/api";

const log: AiDirectorLog = {
  provider: "gemini", model: "gemini-3.5-flash-lite", reused: false, latencyMs: 5400, tokens: { input: 2019, output: 1160 },
  idea: "A slow luxurious reveal of the ring.", style: { asked: "luxury", used: "luxury" }, grade: { asked: "luxury", used: "luxury" },
  texts: { asked: [], used: [{ text: "Namora Luxury", start: 0.5, end: 2, role: "hook" }] },
  shots: [
    { shot: 1, clip: "ring.mp4", purpose: "hook", beatAlignment: "strong",
      asked: { start: 0, seconds: 2, from: 0, to: 2, effect: "ken burns", transition: "fade", speed: 1, crop: "auto" },
      used: { start: 0, end: 2, from: 0, to: 2, effect: "zoom_in", transition: "cut", transitionSeconds: 0, speed: 1, crop: "auto" },
      changes: ["effect 'ken burns' is not supported -> zoom_in", "the first shot has nothing to transition from -> cut"] },
    { shot: 2, clip: "necklace.mp4", purpose: "reveal", beatAlignment: "beat",
      asked: { start: 2, seconds: 2, from: 1, to: 3, effect: "pan_left", transition: "dissolve", speed: 1, crop: "auto" },
      used: { start: 2, end: 4, from: 1, to: 3, effect: "pan_left", transition: "dissolve", transitionSeconds: 0.3, speed: 1, crop: "auto" },
      changes: [] },
  ],
  fixes: ["Effects mapped to supported ones: ken burns->zoom_in."],
};

describe("What the AI decided", () => {
  it("shows the provider, the idea and every shot: what was asked, what was used and why", () => {
    render(<AiDirectorSection log={log} />);
    expect(screen.getByText(/Gemini · gemini-3.5-flash-lite · answered in 5.4s · 2019 tokens in/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 shots corrected by the safety check/)).toBeInTheDocument();
    expect(screen.getByText("A slow luxurious reveal of the ring.")).toBeInTheDocument();
    const rows = within(screen.getByRole("table", { name: "AI shot decisions" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("0.00–2.00s");
    expect(rows[1]).toHaveTextContent("on a strong beat");
    expect(rows[1]).toHaveTextContent("zoom in");
    expect(rows[1]).toHaveTextContent("asked: ken burns");
    expect(rows[1]).toHaveTextContent("the first shot has nothing to transition from -> cut");
    expect(rows[2]).toHaveTextContent("dissolve 0.3s");
    expect(rows[2]).toHaveTextContent("✓ as asked");
  });

  it("does not claim a change when the AI's choice was used as asked, and shows beat snaps as timing", () => {
    const s = log.shots[1];
    const same = { ...log, shots: [{ ...s, asked: { ...s.asked, effect: "crash_zoom", transition: "slide" },
      used: { ...s.used, effect: "crash_zoom", transition: "slide" }, changes: [], timing: "cut 2.13s -> 2.00s (onto the beat)" }] };
    render(<AiDirectorSection log={same} />);
    expect(screen.queryByText(/asked:/)).toBeNull(); // names with an "s" (slide, crash_zoom) used to be flagged wrongly
    expect(screen.getByText(/every shot used as the AI asked · 1 cut fine-tuned onto the beat/)).toBeInTheDocument();
    expect(screen.getByText("♪ cut 2.13s -> 2.00s (onto the beat)")).toBeInTheDocument();
  });
});
