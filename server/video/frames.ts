import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { findBinary } from "@/server/core/ffmpeg";

/** Video frames for analysis, decoded by FFmpeg (it applies the clip's rotation, like OpenCV's capture did): every
 * `step`-th frame, the real picture cropped out of any padding, scaled to `width` x `height`, as BGR bytes. */

export interface FrameSpec {
  step: number;
  /** normalised x0, y0, x1, y1 of the picture to keep, in the decoded (rotated) frame; null = all of it */
  rect: [number, number, number, number] | null;
  srcW: number;
  srcH: number;
  width: number;
  height: number;
  gray?: boolean;
  /** only these frame numbers (instead of every step-th) */
  frames?: number[];
}

export async function* readFrames(file: string, spec: FrameSpec): AsyncGenerator<{ n: number; data: Uint8Array }> {
  const filters: string[] = [];
  if (spec.frames) filters.push(`select='${spec.frames.map((n) => `eq(n\\,${n})`).join("+")}'`);
  else if (spec.step > 1) filters.push(`select='not(mod(n\\,${spec.step}))'`);
  if (spec.rect) {
    const [x0, y0, x1, y1] = spec.rect;
    const x = Math.trunc(x0 * spec.srcW), y = Math.trunc(y0 * spec.srcH);
    filters.push(`crop=${Math.trunc(x1 * spec.srcW) - x}:${Math.trunc(y1 * spec.srcH) - y}:${x}:${y}`);
  }
  filters.push(`scale=${spec.width}:${spec.height}:flags=area`);
  const pix = spec.gray ? "gray" : "bgr24";
  const args = ["-hide_banner", "-loglevel", "error", "-i", path.resolve(file), "-an", "-vf", filters.join(","), "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", pix, "pipe:1"];
  const p = spawn(findBinary("ffmpeg"), args, { windowsHide: true });
  const size = spec.width * spec.height * (spec.gray ? 1 : 3);
  let buf: Buffer = Buffer.alloc(0);
  let k = 0;
  const order = spec.frames ? [...spec.frames].sort((a, b) => a - b) : null;
  try {
    for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= size) {
        const frame = new Uint8Array(buf.subarray(0, size));
        buf = buf.subarray(size);
        yield { n: order ? order[k] : k * spec.step, data: frame };
        k++;
      }
    }
  } finally {
    p.kill();
  }
}
