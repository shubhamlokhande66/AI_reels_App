import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClipCheckPanel, clipCheck, resolutionNote, stretchOf } from "@/components/organisms/ClipCheckPanel";
import type { Project } from "@/types/api";

const clip = (id: string, width: number | null, height: number | null) => ({
  id, name: `${id}.mp4`, duration: 10, width, height, purged: false, thumbnailUrl: null,
  analysis: { usable: true, goodSeconds: 10, qualityScore: 0.8, flags: width && width < 540 ? ["low_resolution"] : [] }, // as the server flags it
});
const project = (...videos: ReturnType<typeof clip>[]) => ({ id: "p", videos, analysis: null }) as unknown as Project;

describe("low-resolution clips", () => {
  it("measures how much a clip is stretched to fill a 1080x1920 Reel", () => {
    expect(stretchOf({ width: 368, height: 496 })).toBeCloseTo(3.87, 2); // WhatsApp-sized: cropped to 9:16, then enlarged
    expect(stretchOf({ width: 720, height: 1280 })).toBe(1.5);
    expect(stretchOf({ width: 2160, height: 3840 })).toBe(1); // 4K: made smaller, never enlarged
    expect(stretchOf({ width: null, height: null })).toBeNull();
  });

  it("warns only when the Reel would look soft or blurry", () => {
    expect(resolutionNote({ width: 1080, height: 1920 })).toBeNull();
    expect(resolutionNote({ width: 720, height: 1280 })).toBeNull(); // 1.5x still looks sharp
    expect(resolutionNote({ width: 540, height: 960 })?.level).toBe("soft"); // 2x
    expect(resolutionNote({ width: 368, height: 496 })).toEqual({ level: "blurry", text: "low resolution (368×496): stretched 3.9× to fill the Reel, it will look blurry" });
  });

  it("says plainly at the top how many clips are low resolution and what to do, without blocking", () => {
    const p = project(clip("small", 368, 496), clip("ok", 1080, 1920));
    const result = clipCheck(p, 15);
    render(<ClipCheckPanel project={p} result={result} onRemove={() => {}} busy={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1 of 2 clips are low resolution: the Reel will look blurry");
    expect(screen.getByRole("alert")).toHaveTextContent(/original videos from your phone/);
    expect(screen.getByText(/low resolution \(368×496\): stretched 3\.9×/)).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp-compressed/)).not.toBeInTheDocument(); // the measured note replaces the generic one
    expect(result.passed).toBe(true);
  });

  it("shows no warning for sharp clips", () => {
    const p = project({ ...clip("ok", 1080, 1920), analysis: { usable: true, goodSeconds: 20, qualityScore: 0.9, flags: [] } });
    render(<ClipCheckPanel project={p} result={clipCheck(p, 15)} onRemove={() => {}} busy={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
