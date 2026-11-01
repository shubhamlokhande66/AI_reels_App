import { describe, expect, it } from "vitest";
import { assessAutonomousRenderQuality, type AutonomousRenderReport } from "../../../Shared/video-engine/src/index";

const healthyReport = (): AutonomousRenderReport => ({
  expectedDuration: 10,
  actualDuration: 10,
  width: 1080,
  height: 1920,
  fps: 30,
  frames: [
    { time: 0.5, hasFrame: true, blackRatio: 0.02, duplicateDistance: 0.2 },
    { time: 2, hasFrame: true, blackRatio: 0.01, duplicateDistance: 0.18 },
    { time: 5, hasFrame: true, blackRatio: 0.03, duplicateDistance: 0.22 },
    { time: 8, hasFrame: true, blackRatio: 0.01, duplicateDistance: 0.19 },
  ],
  audio: { peakDbfs: -1.5, clippedRatio: 0, silenceRatio: 0.08, integratedLufs: -14 },
});

describe("autonomous render quality gate", () => {
  it("passes a complete export with healthy frame and audio probes", () => {
    const result = assessAutonomousRenderQuality(healthyReport());
    expect(result.status).toBe("pass");
    expect(result.score).toBe(100);
    expect(result.errors).toHaveLength(0);
  });

  it("fails exports with a missing-frame or black-frame problem", () => {
    const report = healthyReport();
    report.frames = [
      { time: 0.5, hasFrame: false, blackRatio: 0.99 },
      { time: 2, hasFrame: true, blackRatio: 0.99 },
      { time: 5, hasFrame: true, blackRatio: 0.99 },
      { time: 8, hasFrame: true, blackRatio: 0.99 },
    ];
    const result = assessAutonomousRenderQuality(report);
    expect(result.status).toBe("fail");
    expect(result.repairs).toContain("retry-decode");
    expect(result.repairs).toContain("remove-black-segment");
  });

  it("fails an export whose duration does not match the edit", () => {
    const report = healthyReport();
    report.actualDuration = 8;
    const result = assessAutonomousRenderQuality(report);
    expect(result.status).toBe("fail");
    expect(result.repairs).toContain("fix-duration");
  });

  it("warns about blurry output without treating the warning as a hard failure", () => {
    const report = healthyReport();
    report.frames = Array.from({ length: 5 }, (_, i) => ({
      time: i + 0.5,
      hasFrame: true,
      blackRatio: 0.02,
      blurScore: 0.01,
      duplicateDistance: 0.2,
    }));
    const result = assessAutonomousRenderQuality(report);
    expect(result.status).toBe("warn");
    expect(result.repairs).toContain("replace-blurry-shot");
  });

  it("fails closed when the renderer supplies no decoded frame samples", () => {
    const report = healthyReport();
    report.frames = [];
    const result = assessAutonomousRenderQuality(report);
    expect(result.status).toBe("fail");
    expect(result.repairs).toContain("retry-decode");
  });
});
