import { describe, expect, it } from "vitest";
import { inspectMusicReelSelection, MUSIC_REEL_MAX_CLIPS } from "@shubix/core/lib/music-reel-media";

const MB = 1024 * 1024;

describe("Music Reel media selection guards", () => {
  it("accepts supported video clips within the 30-clip limit", () => {
    expect(inspectMusicReelSelection([{ type: "video", fileSize: 20 * MB }], 2)).toMatchObject({ error: null, videoCount: 1, requiresLargeFileConfirmation: false });
  });
  it("rejects selections that exceed the clip limit", () => {
    expect(inspectMusicReelSelection([{ type: "video" }, { type: "video" }], 29).error).toContain(String(MUSIC_REEL_MAX_CLIPS));
  });
  it("allows photos as well as videos in Music Reel", () => {
    expect(inspectMusicReelSelection([{ type: "image", fileSize: 4 * MB }])).toMatchObject({ error: null, videoCount: 0, requiresLargeFileConfirmation: false });
  });
  it("asks for confirmation before copying a very large source file", () => {
    expect(inspectMusicReelSelection([{ type: "video", fileSize: 600 * MB }]).requiresLargeFileConfirmation).toBe(true);
  });
  it("asks for confirmation when the combined selection is at least 1 GB", () => {
    expect(inspectMusicReelSelection([{ type: "video", fileSize: 600 * MB }, { type: "video", fileSize: 500 * MB }]).requiresLargeFileConfirmation).toBe(true);
  });
  it("handles missing or invalid file-size metadata without treating it as zero-byte media", () => {
    expect(inspectMusicReelSelection([{ type: "video" }, { type: "video", fileSize: Number.NaN }])).toMatchObject({ error: null, totalBytes: 0, totalSizeLabel: "size unavailable" });
  });
  it("asks again when separate additions cumulatively cross the large-selection threshold", () => {
    expect(inspectMusicReelSelection(
      [{ type: "video", fileSize: 500 * MB }],
      1,
      [{ type: "video", fileSize: 500 * MB }],
    )).toMatchObject({ error: null, totalBytes: 1000 * MB, requiresLargeFileConfirmation: false });
    expect(inspectMusicReelSelection(
      [{ type: "video", fileSize: 524 * MB }],
      1,
      [{ type: "video", fileSize: 500 * MB }],
    )).toMatchObject({ error: null, totalBytes: 1024 * MB, requiresLargeFileConfirmation: true });
  });
});
