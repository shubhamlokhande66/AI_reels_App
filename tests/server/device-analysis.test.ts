// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** A clip analysis made in the browser (lib/clipAnalysis) is kept only when it is for the stored file, and then the
 * Reel's analysis step uses it instead of analysing the clip again. */

const spy = vi.hoisted(() => ({ analyzed: 0 }));
vi.mock("@/server/video/analyzer", async (orig) => {
  const real = await orig<typeof import("@/server/video/analyzer")>();
  return { ...real, analyzeClip: vi.fn(async (...a: Parameters<typeof real.analyzeClip>) => { spy.analyzed++; return real.analyzeClip(...a); }) };
});

let mongo: MongoMemoryServer, storage: string;
let clips: typeof import("@/server/video/clips");
let analyzeClip: typeof import("@/server/video/analyzer").analyzeClip;
let mainDb: typeof import("@/server/core/db").mainDb, ObjectId: typeof import("@/server/core/db").ObjectId;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } }); // slow to start while other tests run
  storage = fs.mkdtempSync(path.join(os.tmpdir(), "storage_"));
  Object.assign(process.env, { MONGODB_URI: mongo.getUri(), MONGODB_DB: "device_analysis", STORAGE_PATH: storage, STORAGE_MOUNTED: "false" });
  clips = await import("@/server/video/clips");
  ({ analyzeClip } = await import("@/server/video/analyzer"));
  ({ mainDb, ObjectId } = await import("@/server/core/db"));
}, 120_000);

afterAll(async () => {
  const { client } = await import("@/server/core/db");
  await (await client()).close();
  await mongo?.stop();
});

/** A project with one stored 4-second clip. */
async function projectWithClip() {
  const { findBinary } = await import("@/server/core/ffmpeg");
  const d = await mainDb(), pid = new ObjectId(), mid = new ObjectId(), key = `projects/${pid}/input/${mid}.mp4`, file = path.join(storage, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(findBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
  await d.collection("projects").insertOne({ _id: pid, name: "P", status: "draft", settings: {}, videoOrder: [mid] });
  await d.collection("media").insertOne({ _id: mid, projectId: pid, kind: "video", originalName: "a.mp4", storedKey: key, width: 360, height: 640 });
  return { pid: String(pid), mid: String(mid), key, file };
}

describe("clip analyses made on the person's device", () => {
  it("keeps one made for this file, with the server's own file facts, and the Reel's analysis reuses it", { timeout: 120_000 }, async () => {
    const { pid, mid, key, file } = await projectWithClip();
    const fromPhone = JSON.parse(JSON.stringify(await analyzeClip(file, "on-the-phone"))); // what the browser sends
    fromPhone.metadata.codec = "avc"; // the browser names the codec its own way
    expect(await clips.saveDeviceAnalysis(pid, mid, fromPhone)).toEqual({ used: true });

    spy.analyzed = 0;
    const out = await clips.analyzeVideos(pid, [{ id: mid, name: "a.mp4", key, width: 360, height: 640 }]);
    expect(spy.analyzed).toBe(0); // nothing analysed again on the server
    expect(out.get(mid)!.clipId).toBe(mid);
    expect(out.get(mid)!.metadata.codec).toBe("h264"); // the server's probe, not the browser's word
    expect(out.get(mid)!.qualityScore).toBe(fromPhone.qualityScore);
  });

  it("refuses one made for another file, an older analysis version, or something else entirely", { timeout: 120_000 }, async () => {
    const { pid, mid, file } = await projectWithClip();
    const a = JSON.parse(JSON.stringify(await analyzeClip(file, "x")));
    expect((await clips.saveDeviceAnalysis(pid, mid, { ...a, metadata: { ...a.metadata, width: 1080, height: 1920 } })).used).toBe(false);
    expect((await clips.saveDeviceAnalysis(pid, mid, { ...a, metadata: { ...a.metadata, duration: 9 } })).used).toBe(false);
    expect((await clips.saveDeviceAnalysis(pid, mid, { ...a, analysisVersion: 1 })).used).toBe(false);
    expect((await clips.saveDeviceAnalysis(pid, mid, { hello: "world" })).used).toBe(false);
  });
});
