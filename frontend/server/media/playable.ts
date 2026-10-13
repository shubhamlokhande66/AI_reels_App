import "server-only";
import fs from "node:fs";
import { runFfmpeg } from "@/server/core/ffmpeg";

/** Songs in a type the browser plays, from the file's content, not its name: a WhatsApp ".mpeg" song is an MP3 that
 * its name labels video/mpeg, which an audio player refuses. A format no browser plays (AMR voice notes, WMA...) gets
 * an MP3 copy made once next to it. (Was backend/app/api/projects.py: sniff_audio / playable_audio.) */

export function sniffAudio(file: string): string | null {
  const fd = fs.openSync(file, "r");
  const h = Buffer.alloc(12);
  fs.readSync(fd, h, 0, 12, 0);
  fs.closeSync(fd);
  const s = (a: number, b: number) => h.subarray(a, b).toString("latin1");
  if (s(0, 3) === "ID3" || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0 && (h[1] & 0x06) !== 0)) return "audio/mpeg";
  if (s(4, 8) === "ftyp") return "audio/mp4";
  if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "audio/wav";
  if (s(0, 4) === "OggS") return "audio/ogg";
  if (s(0, 4) === "fLaC") return "audio/flac";
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) return "audio/aac";
  if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return "audio/webm";
  return null;
}

export async function playableAudio(file: string): Promise<[string, string]> {
  const type = sniffAudio(file);
  if (type) return [file, type];
  const copy = `${file}.play.mp3`;
  if (!fs.existsSync(copy) || fs.statSync(copy).mtimeMs < fs.statSync(file).mtimeMs) {
    const tmp = `${file}.tmp.mp3`;
    await runFfmpeg(["-i", file, "-vn", "-c:a", "libmp3lame", "-b:a", "160k", tmp], 300_000);
    fs.renameSync(tmp, copy);
  }
  return [copy, "audio/mpeg"];
}
