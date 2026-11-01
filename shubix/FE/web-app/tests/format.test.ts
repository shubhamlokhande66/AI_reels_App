import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatRelative, isAudioFile, isVideoFile, styleLabel } from "@/lib/format";

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(-1)).toBe("—");
  });
  it("formats durations", () => {
    expect(formatDuration(15)).toBe("0:15");
    expect(formatDuration(65.4)).toBe("1:05");
    expect(formatDuration(null)).toBe("—");
  });
  it("formats relative time", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(formatRelative("2026-01-01T11:59:40Z", now)).toBe("just now");
    expect(formatRelative("2026-01-01T11:30:00Z", now)).toBe("30 min ago");
    expect(formatRelative("2026-01-01T09:00:00Z", now)).toBe("3 h ago");
  });
  it("labels styles and validates file types", () => {
    expect(styleLabel("fast_trending")).toBe("Fast Trending");
    expect(styleLabel("mystery")).toBe("mystery");
    expect(isVideoFile(new File([""], "A.MP4"))).toBe(true);
    expect(isVideoFile(new File([""], "a.exe"))).toBe(false);
    expect(isAudioFile(new File([""], "song.m4a"))).toBe(true);
    expect(isAudioFile(new File([""], "song.mp4"))).toBe(false);
  });
});
