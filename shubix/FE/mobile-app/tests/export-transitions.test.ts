import { describe, expect, it, vi } from "vitest";
import type { ReelProject } from "@mobile/validations";

const specs = vi.hoisted(() => [] as { clips: { tr?: { id: string }; keep?: boolean }[] }[]);
vi.mock("expo-file-system", () => ({ Paths: { document: { uri: "file:///data/" } } }));
vi.mock("../modules/shubix-video", () => ({
  ShubixVideo: {
    addListener: () => ({ remove() {} }),
    exportReel: async (spec: string) => { specs.push(JSON.parse(spec)); return { uri: "file:///data/out.mp4" }; },
  },
}));
import { exportReel } from "../lib/video";

const reel = (...transitions: string[]) => ({
  id: "r", settings: {}, overlays: [],
  clips: transitions.map((transition) => ({ uri: "file:///a.mp4", kind: "video", start: 0, end: 2, speed: 1, filter: "Original", effect: "none", transition })),
}) as unknown as ReelProject;

describe("export of a Reel that is not held by the studio", () => {
  it("makes what Mix Video chooses, with the studio's own transition", async () => {
    await exportReel(reel("fadein", "dissolve", "slideleft"), () => {});
    const { clips } = specs[specs.length - 1];
    expect(clips[1].tr?.id).toBe("dissolve");
    expect(clips[0].keep).toBe(true);
  });

  it("still stops on a transition the phone has not got", async () => {
    await expect(exportReel(reel("fadein", "morph"), () => {})).rejects.toThrow("morph transition is not supported");
  });
});
