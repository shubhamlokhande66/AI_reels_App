// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpegAvailable, findBinary } from "../../src/server/core/ffmpeg";
import { CONVERT_LIMITS, convertFile, convertFilter, convertStatus, startConvert } from "../../src/server/studio/convert";

/** Clips a browser cannot decode (camera ProRes / 4:2:2, old codecs) are converted here as a job: H.264 1080p 30 fps
 * SDR, HDR tone-mapped. */
const post = (body: Uint8Array, q = "") => new Request("http://x/api/studio/convert" + q, { method: "POST", body, headers: { "content-length": String(body.byteLength) } });

describe("studio clip conversion", () => {
  it("tone-maps HDR only, after bringing the frame rate and the size down", () => {
    const hdr = convertFilter({ color_transfer: "arib-std-b67", color_primaries: "bt2020" });
    expect(hdr).toMatch(/^fps=30,scale=.*tonemap=hable.*format=yuv420p$/);
    expect(convertFilter({ color_transfer: "bt709" })).not.toContain("tonemap");
  });

  it("refuses a file over the size limit before reading it", async () => {
    const r = new Request("http://x/api/studio/convert", { method: "POST", body: new Uint8Array(8), headers: { "content-length": String(CONVERT_LIMITS.bytes + 1) } });
    await expect(startConvert(r)).rejects.toMatchObject({ code: "CONVERT_TOO_BIG" });
  });

  it("says a damaged file is not media", async () => {
    await expect(startConvert(post(new Uint8Array(4096).fill(7)))).rejects.toMatchObject({ code: "CORRUPTED_MEDIA" });
  });

  it.skipIf(!ffmpegAvailable())("converts a 4:2:2 10-bit camera clip to H.264 1080p 30 fps, as a job", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-")), src = path.join(dir, "cam.mov");
    execFileSync(findBinary("ffmpeg"), ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=2560x1440:rate=50:duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv422p10le", "-profile:v", "high422", src]);
    const { id } = await startConvert(post(new Uint8Array(fs.readFileSync(src))));
    let st = convertStatus(id);
    for (let i = 0; i < 120 && st.status === "running"; i++) { await new Promise((r) => setTimeout(r, 250)); st = convertStatus(id); }
    expect(st).toMatchObject({ status: "done", progress: 1 });
    const res = convertFile(new Request("http://x"), id);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    const out = path.join(dir, "out.mp4"); fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    const info = JSON.parse(execFileSync(findBinary("ffprobe"), ["-v", "error", "-print_format", "json", "-show_streams", out]).toString());
    expect(info.streams[0]).toMatchObject({ codec_name: "h264", width: 1920, height: 1080, pix_fmt: "yuv420p", r_frame_rate: "30/1" });
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("a finished job that is gone says so", () => {
    expect(() => convertStatus("nope")).toThrowError(/no longer here/);
  });
});
